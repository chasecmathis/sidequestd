import { StyleSheet, Text, View } from "react-native";

import { API_URL } from "@/lib/api";

/**
 * Placeholder shell. The mobile auth screens land in a later slice — this app is
 * scaffolded now so the shared types and API base URL are wired from the start.
 */
export default function IndexScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.wordmark}>
        Side<Text style={styles.accent}>questd</Text>
      </Text>
      <Text style={styles.body}>
        Mobile client scaffold. Auth screens arrive after the web slice is reviewed.
      </Text>
      <Text style={styles.meta}>API: {API_URL}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 12,
  },
  wordmark: { color: "#eef1f7", fontSize: 32, fontWeight: "600" },
  accent: { color: "#7c5cff" },
  body: { color: "#9aa3b8", fontSize: 15, textAlign: "center" },
  meta: { color: "#5c6478", fontSize: 12, marginTop: 8 },
});
