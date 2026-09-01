/**
 * Caliper primitives.
 *
 * Everything the screens compose from. Keeping them here rather than inline in
 * each screen is what stops the system drifting — the ruler on Home and the
 * ruler on Analysis are the same component, so they cannot disagree.
 *
 * See constants/caliper.ts for the rules these encode (cobalt = next action,
 * rust = flag, mono = measured, and the motion scale).
 *
 * ── Why this is a folder ───────────────────────────────────────────────────
 * It was one 1,899-line file. The modules below are the same components in the
 * same order, grouped by what they are for; this barrel keeps every existing
 * `@/components/caliper` import working unchanged, so the split cost no screen
 * a single line.
 *
 * Three exports were dropped on the way past because nothing imported them:
 * `Measured`, `MetricBar` and `MonoChip`. Dead primitives are worse than no
 * primitive — they read as options when they are not.
 */

export { Text, Label, type TextScale } from "./text";

export {
  AppMark,
  Arrow,
  Chevron,
  Check,
  TabIcon,
  AlertGlyph,
  CloseGlyph,
  ExpandGlyph,
  PlusGlyph,
  UploadGlyph,
  PlayGlyph,
  SendGlyph,
  TrashGlyph,
  CameraGlyph,
} from "./glyphs";

export {
  Card,
  Screen,
  Sheet,
  SkeletonBlock,
  StatusBarScrim,
  FooterFade,
  useFooterClearance,
  Avatar,
  ScreenHeader,
  ListRow,
  Tile,
  Entering,
} from "./surfaces";

export {
  MetricBand,
  MiniBand,
  MicroAxis,
  FrequencyChip,
  RangeRuler,
  ReferenceRow,
  Sparkline,
  NoReading,
} from "./charts";

export {
  Chip,
  PrimaryButton,
  BackButton,
  Tappable,
  IconButton,
  TextField,
  Meter,
  Segmented,
} from "./controls";

export { Prescription, FlagRow, EmptyState, Toast } from "./feedback";

export { GUTTER, TAB_BAR } from "@/constants/caliper";
export { bandScale } from "@/utils/bandScale";
