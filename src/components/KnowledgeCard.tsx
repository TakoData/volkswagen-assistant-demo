import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { TakoCard } from "../types";
import { toGlanceableUrl } from "../tako";

function compactAnswer(answer: string) {
  const sentence = answer.split(/(?<=[.!?])\s+/)[0] || answer;
  if (sentence.length <= 118) return sentence;
  const shortened = sentence.slice(0, 115).replace(/\s+\S*$/, "");
  return `${shortened}…`;
}

function cardDocument(url: string) {
  const safeUrl = url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  html,body,#stage{width:100%;height:100%;margin:0;background:#101B27;overflow:hidden}
  #stage{display:flex;align-items:center;justify-content:center}
  #card{display:block;border:0;width:100%;height:100%;transform-origin:center top;background:#101B27}
</style></head><body><div id="stage"><iframe id="card" src="${safeUrl}" scrolling="no"></iframe></div>
<script>
  const frame = document.getElementById('card');
  let cardHeight = window.innerHeight;
  function fit(height) {
    cardHeight = Math.max(1, Number(height) || window.innerHeight);
    const scale = Math.min(1, window.innerHeight / cardHeight);
    frame.style.height = cardHeight + 'px';
    frame.style.width = (100 / scale) + '%';
    frame.style.transform = 'scale(' + scale + ')';
  }
  window.addEventListener('message', function(event) {
    let data = event.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) {} }
    if (data && data.type === 'tako::resize') fit(data.height);
  });
  window.addEventListener('resize', function() { fit(cardHeight); });
  fit(cardHeight);
</script></body></html>`;
}

export function KnowledgeCard({ card, answer }: { card: TakoCard; answer: string }) {
  const url = toGlanceableUrl(card.embedUrl);
  const atAGlance = compactAnswer(answer);
  const compact = atAGlance.length > 86;

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.badge}><Text style={styles.badgeText}>DRIVER BRIEF</Text></View>
        <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail" style={styles.title}>{card.title}</Text>
      </View>
      <View style={styles.highlight}>
        <Text allowFontScaling={false} style={styles.highlightLabel}>KEY ANSWER</Text>
        <Text allowFontScaling={false} numberOfLines={2} ellipsizeMode="tail" style={[styles.highlightText, compact && styles.highlightTextCompact]}>{atAGlance}</Text>
      </View>
      <View style={styles.cardViewport}>
        <WebView
          source={{ html: cardDocument(url), baseUrl: "https://tako.com" }}
          originWhitelist={["https://*", "about:blank"]}
          style={styles.webview}
          containerStyle={styles.webviewContainer}
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <ActivityIndicator color="#00B0F0" size="large" />
              <Text style={styles.loadingText}>Preparing driver view…</Text>
            </View>
          )}
          javaScriptEnabled
          domStorageEnabled
          scrollEnabled={false}
          overScrollMode="never"
          allowsFullscreenVideo={false}
        />
      </View>
      {card.sources.length > 0 && (
        <Text allowFontScaling={false} numberOfLines={1} style={styles.sources}>Source: {card.sources.join(" · ")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    overflow: "hidden",
    borderRadius: 26,
    backgroundColor: "#091722",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  header: { height: 52, flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18 },
  badge: { backgroundColor: "rgba(0,176,240,0.14)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  badgeText: { color: "#61D6FF", fontSize: 10, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: "#F4F7F6", fontSize: 17, fontWeight: "600", flex: 1 },
  highlight: { height: 96, justifyContent: "center", paddingHorizontal: 20, paddingVertical: 11, backgroundColor: "#06283A", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "rgba(0,176,240,0.2)" },
  highlightLabel: { color: "#61D6FF", fontSize: 9, fontWeight: "900", letterSpacing: 1.6, marginBottom: 5 },
  highlightText: { color: "#F5F8F7", fontSize: 20, lineHeight: 25, fontWeight: "700", letterSpacing: -0.25 },
  highlightTextCompact: { fontSize: 17, lineHeight: 22 },
  cardViewport: { flex: 1, marginHorizontal: 10, marginVertical: 9, borderRadius: 18, overflow: "hidden", backgroundColor: "#101B27" },
  webviewContainer: { flex: 1, backgroundColor: "#101B27" },
  webview: { flex: 1, backgroundColor: "#101B27" },
  loading: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: "#101B27" },
  loadingText: { color: "#9DA8A5", fontSize: 13 },
  sources: { color: "#7E929E", fontSize: 10, paddingHorizontal: 18, paddingBottom: 9 },
});
