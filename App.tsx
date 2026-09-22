import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Speech from "expo-speech";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  LogBox,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KnowledgeCard } from "./src/components/KnowledgeCard";
import { Waveform } from "./src/components/Waveform";
import { loadApiKey, removeApiKey, saveApiKey } from "./src/credentials";
import { askTako, usesHostedRelay } from "./src/tako";
import type { AssistantPhase, TakoAnswer } from "./src/types";

LogBox.ignoreLogs(["Introspectable data is missing for class expo.modules.speechrecognition"]);

const SUGGESTIONS = [
  "How did Volkswagen stock perform this month?",
  "What is the weather in Wolfsburg today?",
  "Compare EV sales in Europe and the US",
];

const phaseCopy: Record<AssistantPhase, string> = {
  off: "Tap to talk",
  armed: "Tap to talk",
  listening: "I’m listening…",
  thinking: "Finding a trusted answer",
  speaking: "Here’s what I found",
  complete: "Tap to ask another",
  error: "Let’s try that again",
};

function currentTime() {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
}

export default function App() {
  const [phase, setPhase] = useState<AssistantPhase>("off");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<TakoAnswer | null>(null);
  const [error, setError] = useState("");
  const [inputLevel, setInputLevel] = useState(-2);
  const [clock, setClock] = useState(currentTime());
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [credentialsLoaded, setCredentialsLoaded] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [setupError, setSetupError] = useState("");
  const phaseRef = useRef<AssistantPhase>("off");
  const requestInFlight = useRef(false);
  const glow = useRef(new Animated.Value(0)).current;

  const updatePhase = useCallback((next: AssistantPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(currentTime()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    void loadApiKey()
      .then((savedKey) => {
        setApiKey(savedKey);
        setShowSetup(false);
      })
      .finally(() => setCredentialsLoaded(true));
  }, []);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 1100, useNativeDriver: true }),
      ]),
    );
    if (phase === "listening" || phase === "thinking") animation.start();
    else { animation.stop(); glow.setValue(0); }
    return () => animation.stop();
  }, [glow, phase]);

  const startListening = useCallback(async () => {
    if (requestInFlight.current || phaseRef.current === "thinking") return;
    if (!usesHostedRelay && !apiKey) {
      setError("Assistant setup is incomplete. Ask the demo administrator for help.");
      updatePhase("error");
      return;
    }
    setError("");
    setTranscript("");
    setInputLevel(-2);

    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      setError("Please allow microphone access so Volkswagen Assistant can hear you.");
      updatePhase("error");
      return;
    }

    setVoiceEnabled(true);
    try {
      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        contextualStrings: ["Volkswagen"],
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: "web_search" },
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });
      updatePhase("listening");
    } catch (recognitionError) {
      setError(recognitionError instanceof Error ? recognitionError.message : "Voice recognition is unavailable.");
      updatePhase("error");
    }
  }, [apiKey, updatePhase]);

  const speakAnswer = useCallback(async (text: string) => {
    // `stop` is asynchronous on Android. Waiting prevents it from cancelling
    // the new utterance that follows immediately after a Tako response.
    await Speech.stop();
    await new Promise((resolve) => setTimeout(resolve, 180));
    updatePhase("speaking");
    Speech.speak(text, {
      language: "en-US",
      rate: 0.92,
      pitch: 0.98,
      volume: 1,
      onDone: () => {
        requestInFlight.current = false;
        updatePhase("complete");
      },
      onStopped: () => {
        requestInFlight.current = false;
        updatePhase("complete");
      },
      onError: () => {
        requestInFlight.current = false;
        setError("The answer is on screen, but Android could not read it aloud. Tap Replay.");
        updatePhase("error");
      },
    });
  }, [updatePhase]);

  const ask = useCallback(async (rawQuestion: string) => {
    const cleanQuestion = rawQuestion.trim().replace(/[.?!]+$/, "");
    if (!cleanQuestion || requestInFlight.current) return;

    requestInFlight.current = true;
    setQuestion(cleanQuestion);
    setTranscript(cleanQuestion);
    setResult(null);
    setError("");
    updatePhase("thinking");
    try { ExpoSpeechRecognitionModule.abort(); } catch {}

    try {
      if (!usesHostedRelay && !apiKey) {
        throw new Error("Add an API key before asking a question.");
      }
      const answer = await askTako(cleanQuestion, apiKey);
      setResult(answer);
      void speakAnswer(answer.answer);
    } catch (askError) {
      requestInFlight.current = false;
      setError(askError instanceof Error ? askError.message : "The answer service is unavailable.");
      updatePhase("error");
    }
  }, [apiKey, speakAnswer, updatePhase]);

  const storeApiKey = useCallback(async () => {
    const cleanKey = apiKeyDraft.trim();
    if (cleanKey.length < 12 || /\s/.test(cleanKey)) {
      setSetupError("Paste the complete API key without spaces.");
      return;
    }
    try {
      await saveApiKey(cleanKey);
      const persistedKey = await loadApiKey();
      if (persistedKey !== cleanKey) {
        throw new Error("The saved key could not be read back.");
      }
      setApiKey(cleanKey);
      setApiKeyDraft("");
      setSetupError("");
      setShowApiKey(false);
      setShowSetup(false);
      setError("");
      updatePhase("off");
    } catch {
      setSetupError("Android could not save the key securely. Please try again.");
    }
  }, [apiKeyDraft, updatePhase]);

  const forgetApiKey = useCallback(async () => {
    await removeApiKey();
    setApiKey(null);
    setApiKeyDraft("");
    setSetupError("");
    setResult(null);
    setQuestion("");
  }, []);

  useSpeechRecognitionEvent("result", (event) => {
    const heard = event.results[0]?.transcript?.trim() ?? "";
    if (!heard || requestInFlight.current) return;
    setTranscript(heard);
    if (!event.isFinal) return;

    if (phaseRef.current === "listening") void ask(heard);
  });

  useSpeechRecognitionEvent("volumechange", (event) => {
    setInputLevel(event.value);
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted" || requestInFlight.current) return;
    const message = event.error === "no-speech"
      ? "I didn’t hear anything. Tap the microphone and try again."
      : event.error === "not-allowed"
        ? "Microphone access is off. Allow it in Android Settings, then tap Retry."
        : event.message || "Voice recognition stopped. Tap Retry to try again.";
    setError(message);
    updatePhase("error");
  });

  useSpeechRecognitionEvent("end", () => {
    setInputLevel(-2);
    if (!requestInFlight.current && phaseRef.current === "listening") {
      updatePhase("armed");
    }
  });

  const stopListening = () => {
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
  };

  const stopSpeaking = () => {
    Speech.stop();
    requestInFlight.current = false;
    updatePhase("complete");
  };

  const leadCard = result?.cards[0];
  const active = phase === "listening" || phase === "thinking" || phase === "speaking";

  return (
    <LinearGradient colors={["#001E32", "#07141D", "#05090D"]} locations={[0, 0.48, 1]} style={styles.app}>
      <StatusBar hidden />
      <View pointerEvents="none" style={styles.ambientGlow} />
      <View style={styles.safe}>
        <View style={styles.idLight}>
          <Animated.View style={[styles.idLightActive, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) }]} />
        </View>

        <View style={styles.topbar}>
          <Pressable
            style={styles.brandGroup}
            onLongPress={() => {
              if (!usesHostedRelay) setShowSetup(true);
            }}
            delayLongPress={1200}
            accessibilityRole="image"
            accessibilityLabel="Volkswagen"
          >
            <View style={styles.vwMark}><Text style={styles.vwText}>VW</Text></View>
            <Text style={styles.brand}>VOLKSWAGEN</Text>
          </Pressable>
          <View style={styles.routePill}>
            <MaterialCommunityIcons name="navigation-variant-outline" color="#00B0F0" size={17} />
            <Text style={styles.routeText}>Wolfsburg • Autostadt</Text>
          </View>
          <View style={styles.systemGroup}>
            <MaterialCommunityIcons name="signal-cellular-3" color="#C6CFCC" size={18} />
            <MaterialCommunityIcons name="bluetooth" color="#C6CFCC" size={17} />
            <Text style={styles.temperature}>20.5°</Text>
            <Text style={styles.clock}>{clock}</Text>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.assistantPanel}>
            <View>
              <View style={styles.eyebrowRow}>
                <View style={[styles.statusDot, active && styles.statusDotActive]} />
                <Text style={styles.eyebrow}>VOLKSWAGEN ASSISTANT</Text>
              </View>
              <Text allowFontScaling={false} style={styles.phaseTitle}>{phaseCopy[phase]}</Text>
              {(phase === "listening" || phase === "thinking") && transcript ? (
                <Text allowFontScaling={false} numberOfLines={3} ellipsizeMode="tail" style={styles.transcript}>“{transcript}”</Text>
              ) : question ? (
                <Text allowFontScaling={false} numberOfLines={2} ellipsizeMode="tail" style={styles.question}>You asked: {question}</Text>
              ) : (
                <Text style={styles.hint}>Ask about markets, weather, sports, companies, or the world around you.</Text>
              )}
            </View>

            <View style={styles.voiceCenter}>
              <Pressable
                onPress={() => {
                  if (phase === "speaking") stopSpeaking();
                  else if (phase === "listening") stopListening();
                  else if (phase !== "thinking") void startListening();
                }}
                style={({ pressed }) => [styles.orb, active && styles.orbActive, pressed && styles.orbPressed]}
                accessibilityRole="button"
                accessibilityLabel={phase === "listening" ? "Stop listening" : "Tap to talk"}
              >
                {phase === "thinking" ? (
                  <ActivityIndicator size="large" color="#00B0F0" />
                ) : (
                  <MaterialCommunityIcons
                    name={phase === "speaking" || phase === "listening" ? "stop" : "microphone"}
                    color={active ? "#001E32" : "#EAF1EF"}
                    size={35}
                  />
                )}
              </Pressable>
              <View>
                <Waveform active={phase === "listening" || phase === "speaking"} level={inputLevel} />
                {phase === "listening" && (
                  <Text style={styles.micStatus}>
                    {inputLevel > 0 ? "Voice detected" : "Listening for your voice"}
                  </Text>
                )}
              </View>
            </View>

            {error ? (
              <View style={styles.errorBox}>
                <MaterialCommunityIcons name="alert-circle-outline" size={18} color="#FFB79F" />
                <Text numberOfLines={2} style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => void startListening()}><Text style={styles.retry}>Retry</Text></Pressable>
              </View>
            ) : !voiceEnabled ? (
              <Pressable style={styles.enableButton} onPress={() => void startListening()}>
                <MaterialCommunityIcons name="microphone" color="#001E32" size={20} />
                <Text style={styles.enableButtonText}>Tap to talk</Text>
              </Pressable>
            ) : !result ? (
              <View style={styles.suggestions}>
                {SUGGESTIONS.slice(0, 2).map((suggestion) => (
                  <Pressable key={suggestion} onPress={() => void ask(suggestion)} style={styles.suggestion}>
                    <Text numberOfLines={1} style={styles.suggestionText}>{suggestion}</Text>
                    <MaterialCommunityIcons name="arrow-top-right" color="#899592" size={16} />
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.answerBox}>
                <View style={styles.answerLabelRow}>
                  <Text style={styles.answerLabel}>ANSWER</Text>
                  <Pressable
                    onPress={() => void speakAnswer(result.answer)}
                    style={styles.replayButton}
                    accessibilityLabel="Replay spoken answer"
                  >
                    <MaterialCommunityIcons name={phase === "speaking" ? "volume-high" : "replay"} color="#00B0F0" size={15} />
                    <Text style={styles.nowSpeaking}>{phase === "speaking" ? "READING ALOUD" : "REPLAY"}</Text>
                  </Pressable>
                </View>
                <Text allowFontScaling={false} numberOfLines={4} ellipsizeMode="tail" style={styles.answerText}>{result.answer}</Text>
              </View>
            )}
          </View>

          <View style={styles.visualPanel}>
            {leadCard ? (
              <KnowledgeCard card={leadCard} answer={result?.answer ?? ""} />
            ) : (
              <View style={styles.mapShell}>
                <View style={styles.mapGrid} />
                <View style={[styles.road, styles.roadOne]} />
                <View style={[styles.road, styles.roadTwo]} />
                <View style={[styles.road, styles.roadThree]} />
                <View style={styles.destinationPin}>
                  <MaterialCommunityIcons name="map-marker" size={28} color="#001E32" />
                </View>
                <View style={styles.mapInfo}>
                  <Text style={styles.mapEta}>12 min</Text>
                  <Text style={styles.mapDestination}>Autostadt, Wolfsburg</Text>
                  <Text style={styles.mapMeta}>6.4 km • Arrival 4:32 PM</Text>
                </View>
                <View style={styles.safetyBadge}>
                  <MaterialCommunityIcons name="eye-outline" color="#00B0F0" size={18} />
                  <Text style={styles.safetyText}>Glanceable mode ready</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        <View style={styles.climateBar}>
          <Text style={styles.climateTemp}>20.5°</Text>
          <MaterialCommunityIcons name="car-seat-heater" size={22} color="#D4DEDB" />
          <Text style={styles.auto}>AUTO</Text>
          <View style={styles.climateSpacer} />
          <MaterialCommunityIcons name="fan" size={22} color="#00B0F0" />
          <View style={styles.fanLevel}><View style={styles.fanLevelActive} /></View>
          <View style={styles.climateSpacer} />
          <Text style={styles.auto}>SYNC</Text>
          <MaterialCommunityIcons name="car-seat-heater" size={22} color="#D4DEDB" />
          <Text style={styles.climateTemp}>20.5°</Text>
        </View>
      </View>

      <Modal visible={credentialsLoaded && showSetup} transparent animationType="fade" onRequestClose={() => setShowSetup(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.setupBackdrop}
        >
          <ScrollView
            style={styles.setupScroll}
            contentContainerStyle={styles.setupScrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
          <View style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <MaterialCommunityIcons name="key-variant" color="#001E32" size={29} />
            </View>
            <Text allowFontScaling={false} style={styles.setupEyebrow}>ADMINISTRATOR SETUP</Text>
            <Text allowFontScaling={false} style={styles.setupTitle}>{apiKey ? "Data access settings" : "Configure data access"}</Text>
            <Text allowFontScaling={false} style={styles.setupCopy}>
              {apiKey
                ? "An API key is saved securely on this device. Replace it or remove it before handing the device to someone else."
                : "Paste your Tako API key. It stays encrypted on this Android device and is sent only to Tako when you ask a question."}
            </Text>

            <View style={styles.keyField}>
              <MaterialCommunityIcons name="shield-key-outline" color="#7B8C94" size={20} />
              <TextInput
                value={apiKeyDraft}
                onChangeText={(value) => { setApiKeyDraft(value); setSetupError(""); }}
                placeholder={apiKey ? "Paste a replacement key" : "Paste API key"}
                placeholderTextColor="#66777E"
                secureTextEntry={!showApiKey}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="visible-password"
                style={styles.keyInput}
                accessibilityLabel="Tako API key"
              />
              <Pressable onPress={() => setShowApiKey((visible) => !visible)} style={styles.revealButton}>
                <MaterialCommunityIcons name={showApiKey ? "eye-off-outline" : "eye-outline"} color="#AFC0C7" size={20} />
              </Pressable>
            </View>
            {!!setupError && <Text style={styles.setupError}>{setupError}</Text>}

            <View style={styles.setupActions}>
              {apiKey && (
                <Pressable onPress={() => void forgetApiKey()} style={styles.removeKeyButton}>
                  <Text style={styles.removeKeyText}>Remove key</Text>
                </Pressable>
              )}
              {apiKey && (
                <Pressable onPress={() => setShowSetup(false)} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              )}
              <Pressable onPress={() => void storeApiKey()} style={[styles.saveKeyButton, !apiKeyDraft.trim() && styles.saveKeyButtonDisabled]} disabled={!apiKeyDraft.trim()}>
                <Text style={styles.saveKeyText}>{apiKey ? "Replace key" : "Save and continue"}</Text>
                <MaterialCommunityIcons name="arrow-right" color="#001E32" size={19} />
              </Pressable>
            </View>
            <Text style={styles.setupFootnote}>Administrators can return here by long-pressing the Volkswagen logo.</Text>
          </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  ambientGlow: { position: "absolute", top: -180, right: -100, width: 620, height: 420, borderRadius: 310, backgroundColor: "rgba(0,99,160,0.11)", shadowColor: "#00B0F0", shadowOpacity: 0.2, shadowRadius: 80 },
  safe: { flex: 1, paddingHorizontal: 20, paddingBottom: 12 },
  idLight: { height: 4, marginHorizontal: -20, backgroundColor: "rgba(255,255,255,0.04)" },
  idLightActive: { height: 4, width: "44%", alignSelf: "center", backgroundColor: "#00B0F0", shadowColor: "#00B0F0", shadowOpacity: 1, shadowRadius: 16, elevation: 12 },
  topbar: { height: 65, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandGroup: { flexDirection: "row", alignItems: "center", gap: 11, width: 220 },
  vwMark: { height: 34, width: 34, borderRadius: 18, borderWidth: 1.5, borderColor: "#EAF1EF", alignItems: "center", justifyContent: "center" },
  vwText: { color: "#EAF1EF", fontSize: 11, fontWeight: "800", letterSpacing: -0.5 },
  brand: { color: "#EAF1EF", fontSize: 12, fontWeight: "700", letterSpacing: 1.8 },
  routePill: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.06)", paddingHorizontal: 15, paddingVertical: 9 },
  routeText: { color: "#C6CFCC", fontSize: 12, fontWeight: "600" },
  systemGroup: { width: 220, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12 },
  temperature: { color: "#C6CFCC", fontSize: 13, fontWeight: "600" },
  clock: { color: "#F4F7F6", fontSize: 15, fontWeight: "700", marginLeft: 4 },
  content: { flex: 1, flexDirection: "row", gap: 16, minHeight: 0 },
  assistantPanel: { width: "39%", borderRadius: 28, backgroundColor: "rgba(7,25,36,0.94)", borderWidth: 1, borderColor: "rgba(130,205,235,0.1)", padding: 24, justifyContent: "space-between" },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  statusDot: { height: 7, width: 7, borderRadius: 4, backgroundColor: "#59615F" },
  statusDotActive: { backgroundColor: "#00B0F0", shadowColor: "#00B0F0", shadowOpacity: 1, shadowRadius: 8 },
  eyebrow: { color: "#8D9996", fontSize: 10, fontWeight: "800", letterSpacing: 1.7 },
  phaseTitle: { color: "#F5F8F7", fontSize: 27, lineHeight: 32, fontWeight: "500", letterSpacing: -0.7 },
  hint: { color: "#87928F", fontSize: 14, lineHeight: 20, marginTop: 11, maxWidth: 360 },
  transcript: { color: "#B9C5C1", fontSize: 16, lineHeight: 23, marginTop: 12 },
  question: { color: "#899592", fontSize: 13, lineHeight: 19, marginTop: 10 },
  voiceCenter: { flexDirection: "row", alignItems: "center", gap: 24 },
  micStatus: { color: "#8D9996", fontSize: 10, fontWeight: "700", letterSpacing: 0.6, marginTop: -6 },
  orb: { height: 76, width: 76, borderRadius: 38, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)" },
  orbActive: { backgroundColor: "#00B0F0", borderColor: "#8ADDFA", shadowColor: "#00B0F0", shadowOpacity: 0.45, shadowRadius: 24, elevation: 10 },
  orbPressed: { transform: [{ scale: 0.96 }] },
  enableButton: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 16, backgroundColor: "#00B0F0" },
  enableButtonText: { color: "#001E32", fontSize: 14, fontWeight: "800" },
  suggestions: { gap: 8 },
  suggestion: { height: 43, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, backgroundColor: "rgba(255,255,255,0.045)", paddingHorizontal: 14 },
  suggestionText: { color: "#B3BEBA", fontSize: 12, flex: 1, marginRight: 10 },
  answerBox: { minWidth: 0, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: 15 },
  answerLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 7 },
  answerLabel: { color: "#61D6FF", fontSize: 10, fontWeight: "800", letterSpacing: 1.6 },
  nowSpeaking: { color: "#8D9996", fontSize: 9, fontWeight: "700", letterSpacing: 1.2 },
  replayButton: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, marginVertical: -4 },
  answerText: { color: "#DCE4E1", fontSize: 14, lineHeight: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 14, padding: 12, backgroundColor: "rgba(255,105,75,0.1)" },
  errorText: { color: "#FFCEBF", fontSize: 12, flex: 1 },
  retry: { color: "#61D6FF", fontSize: 12, fontWeight: "800" },
  visualPanel: { flex: 1, minWidth: 0, paddingRight: 2 },
  mapShell: { flex: 1, borderRadius: 28, overflow: "hidden", backgroundColor: "#091722", borderWidth: 1, borderColor: "rgba(130,205,235,0.1)" },
  mapGrid: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, opacity: 0.32, borderWidth: 44, borderColor: "#19201F" },
  road: { position: "absolute", height: 10, borderRadius: 10, backgroundColor: "#313A38", transform: [{ rotate: "-18deg" }] },
  roadOne: { width: "120%", left: "-10%", top: "47%" },
  roadTwo: { width: "75%", left: "28%", top: "24%", transform: [{ rotate: "54deg" }] },
  roadThree: { width: "70%", left: "-14%", top: "74%", transform: [{ rotate: "31deg" }] },
  destinationPin: { position: "absolute", left: "58%", top: "31%", height: 50, width: 50, borderRadius: 25, backgroundColor: "#00B0F0", alignItems: "center", justifyContent: "center", shadowColor: "#00B0F0", shadowOpacity: 0.35, shadowRadius: 18 },
  mapInfo: { position: "absolute", left: 22, bottom: 20, borderRadius: 20, backgroundColor: "rgba(8,13,12,0.9)", paddingHorizontal: 18, paddingVertical: 14, minWidth: 220 },
  mapEta: { color: "#61D6FF", fontSize: 25, fontWeight: "600" },
  mapDestination: { color: "#EFF4F2", fontSize: 14, fontWeight: "700", marginTop: 3 },
  mapMeta: { color: "#899592", fontSize: 11, marginTop: 4 },
  safetyBadge: { position: "absolute", top: 18, right: 18, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(8,13,12,0.88)", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 9 },
  safetyText: { color: "#C5CFCC", fontSize: 11, fontWeight: "600" },
  climateBar: { height: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  climateTemp: { color: "#F0F5F3", fontSize: 18, fontWeight: "600" },
  auto: { color: "#AAB5B1", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  climateSpacer: { width: 40 },
  fanLevel: { width: 90, height: 3, borderRadius: 3, backgroundColor: "#39413F" },
  fanLevelActive: { width: "58%", height: 3, borderRadius: 3, backgroundColor: "#00B0F0" },
  setupBackdrop: { flex: 1, backgroundColor: "rgba(0,7,12,0.88)" },
  setupScroll: { flex: 1, width: "100%" },
  setupScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  setupCard: { width: "58%", maxWidth: 650, minWidth: 520, borderRadius: 28, padding: 30, backgroundColor: "#091A25", borderWidth: 1, borderColor: "rgba(97,214,255,0.22)", shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 28, elevation: 22 },
  setupIcon: { width: 54, height: 54, borderRadius: 27, alignItems: "center", justifyContent: "center", backgroundColor: "#61D6FF", marginBottom: 18 },
  setupEyebrow: { color: "#61D6FF", fontSize: 10, fontWeight: "900", letterSpacing: 1.8, marginBottom: 8 },
  setupTitle: { color: "#F5F8F7", fontSize: 27, lineHeight: 32, fontWeight: "600", letterSpacing: -0.6 },
  setupCopy: { color: "#A9B8BC", fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 20, maxWidth: 560 },
  keyField: { height: 54, flexDirection: "row", alignItems: "center", borderRadius: 15, borderWidth: 1, borderColor: "rgba(175,192,199,0.25)", backgroundColor: "#06131C", paddingLeft: 15 },
  keyInput: { flex: 1, color: "#F2F7F8", fontSize: 15, marginLeft: 10, paddingVertical: 0 },
  revealButton: { width: 50, height: 52, alignItems: "center", justifyContent: "center" },
  setupError: { color: "#FFB79F", fontSize: 12, marginTop: 9 },
  setupActions: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 10, marginTop: 20 },
  removeKeyButton: { paddingHorizontal: 5, paddingVertical: 12, marginRight: "auto" },
  removeKeyText: { color: "#FFB79F", fontSize: 13, fontWeight: "700" },
  cancelButton: { paddingHorizontal: 17, paddingVertical: 13, borderRadius: 13 },
  cancelText: { color: "#C6CFCC", fontSize: 13, fontWeight: "700" },
  saveKeyButton: { minWidth: 170, height: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, backgroundColor: "#61D6FF", paddingHorizontal: 18 },
  saveKeyButtonDisabled: { opacity: 0.38 },
  saveKeyText: { color: "#001E32", fontSize: 13, fontWeight: "900" },
  setupFootnote: { color: "#70828A", fontSize: 10, marginTop: 15, textAlign: "right" },
});
