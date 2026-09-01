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
import { View, Linking, StyleSheet } from "react-native";

import { Label, Text, Tappable } from "@/components/caliper";
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
      {/*
        Was a bare `Pressable` with three problems the audit measured: a `link`
        role with **no accessible name** (announced as an unnamed link), a target
        about 14pt tall carried only by `hitSlop` — which react-native-web
        ignores entirely, so on the browser build it really was 14pt — and a
        hand-written `opacity: 0.7` press, one of the seven drifted values the
        motion scale exists to replace.

        `Tappable` supplies the single press response and the cursor the audit
        harness identifies controls by; `minTarget` meets 44pt with real
        geometry rather than with hitSlop, as its docblock argues for.
      */}
      <Tappable
        onPress={() => Linking.openURL(pubmedUrl(article)).catch(() => {})}
        accessibilityRole="link"
        accessibilityLabel={`Read the research behind ${article.title}, opens PubMed`}
        minTarget
        style={s.link}
      >
        <Text style={[T.measuredSmall, { color: color.cobalt }]}>READ THE RESEARCH ↗</Text>
      </Tappable>
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
  // `alignItems`/`justifyContent` come from Tappable's minTarget; the link only
  // needs to stop stretching to the card's width.
  link: { marginTop: 6, alignSelf: "flex-start" },
});
