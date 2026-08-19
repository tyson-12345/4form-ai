/**
 * The sport science cards — three sourced reads for the picked sport: common
 * injuries, prevention, what good form is. Rendered on the category screen so
 * the athlete sees what the sport's bands are grounded in at the moment they
 * pick it.
 *
 * Each card cites the actual literature and links to a PubMed search for it.
 * The link is a search on the article's topic, never a hardcoded article id —
 * a search always lands somewhere honest.
 */

import React from "react";
import { View, Text, Pressable, Linking, StyleSheet } from "react-native";

import { Label } from "@/components/caliper";
import { color, type as T, radius } from "@/constants/caliper";
import { scienceForSport, pubmedUrl, type SportArticle } from "@/constants/sportScience";

const KIND_LABEL: Record<SportArticle["kind"], string> = {
  injuries: "COMMON INJURIES",
  prevention: "PREVENTION",
  form: "WHAT GOOD FORM IS",
};

function ArticleCard({ article }: { article: SportArticle }) {
  return (
    <View style={s.card}>
      <Label style={{ color: color.cobalt }}>{KIND_LABEL[article.kind]}</Label>
      <Text style={[T.cardTitle, { marginTop: 6 }]}>{article.title}</Text>
      <Text style={[T.bodySmall, { marginTop: 6 }]}>{article.body}</Text>
      <Text style={[T.measuredSmall, { marginTop: 10, color: color.textMuted }]}>
        {article.source}
      </Text>
      <Pressable
        onPress={() => Linking.openURL(pubmedUrl(article)).catch(() => {})}
        hitSlop={8}
        accessibilityRole="link"
        style={({ pressed }) => [s.link, pressed && { opacity: 0.7 }]}
      >
        <Text style={[T.measuredSmall, { color: color.cobalt }]}>READ THE RESEARCH ↗</Text>
      </Pressable>
    </View>
  );
}

export function SportScience({ sport }: { sport: string }) {
  const articles = scienceForSport(sport);
  return (
    <View>
      {articles.map((a) => (
        <ArticleCard key={a.kind} article={a} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: radius.cardSmall,
    padding: 14,
    marginBottom: 10,
  },
  link: { marginTop: 10, alignSelf: "flex-start" },
});
