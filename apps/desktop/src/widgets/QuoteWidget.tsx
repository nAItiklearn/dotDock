import { useMemo } from "react";
import { Icon } from "../design-system/Icon";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { SHORT_QUOTE_LIMIT, QUOTES, parseCustomQuote, type Quote } from "./data/quotes";
import { defineWidget, type WidgetProps } from "./definition";
import { pickRotated, type RotationPeriod } from "./rotation";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { WidgetNotice } from "./WidgetNotice";
import "./QuoteWidget.css";

export type QuoteSource = "bundled" | "custom" | "both";

export interface QuoteConfig {
  readonly source: QuoteSource;
  readonly rotation: RotationPeriod;
  /** One quote per line, optionally `text | author`. */
  readonly customQuotes: readonly string[];
}

export const QUOTE_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Card", w: 4, h: 2 },
  { id: "s", name: "Circle", w: 2, h: 2 },
];

const MAX_CUSTOM = 50;
const MAX_QUOTE_LENGTH = 280;
const SALT = 11;

const QUOTE_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: {
      type: "string",
      title: "Quotes from",
      default: "bundled",
      oneOf: [
        { const: "bundled", title: "Built-in collection" },
        { const: "custom", title: "My own list" },
        { const: "both", title: "Both" },
      ],
    },
    rotation: {
      type: "string",
      title: "Change quote",
      default: "daily",
      oneOf: [
        { const: "daily", title: "Every day" },
        { const: "hourly", title: "Every hour" },
      ],
    },
    customQuotes: {
      type: "array",
      title: "My quotes",
      description: "One per line. Add the author after a bar: Stay curious | Someone",
      default: [],
      maxItems: MAX_CUSTOM,
      uniqueItems: true,
      items: { type: "string", maxLength: MAX_QUOTE_LENGTH },
    },
  },
};

const DEFAULT_CONFIG: QuoteConfig = { source: "bundled", rotation: "daily", customQuotes: [] };

/** The quotes a size may draw from. The circle only has room for short ones. */
export function quotePool(config: QuoteConfig, size: SizeId): readonly Quote[] {
  const custom = config.customQuotes.map(parseCustomQuote).filter((q): q is Quote => q !== null);
  const all = config.source === "bundled" ? QUOTES : config.source === "custom" ? custom : [...custom, ...QUOTES];
  if (size !== "s") return all;
  const short = all.filter((q) => q.text.length <= SHORT_QUOTE_LIMIT);
  return short.length > 0 ? short : all;
}

function QuoteBody({ quote, size }: { readonly quote: Quote; readonly size: SizeId }) {
  return (
    <figure className={`quote quote--${size}`}>
      <Icon className="quote__mark" name="quote" />
      <blockquote className="quote__text">{quote.text}</blockquote>
      <figcaption className="quote__by">
        <Caps accent>{quote.author}</Caps>
        {quote.work && size !== "s" ? <span className="quote__work">{quote.work}</span> : null}
      </figcaption>
    </figure>
  );
}

export function QuoteWidget({ size = "m", config = DEFAULT_CONFIG }: { readonly size?: SizeId; readonly config?: QuoteConfig }) {
  const now = useMinute();
  const spec = sizeSpec(QUOTE_SIZES, size);
  const shape = size === "s" ? "circle" : "card";
  const pool = useMemo(() => quotePool(config, size), [config, size]);
  const quote = pickRotated(pool, now, config.rotation, SALT);
  return (
    <Surface shape={shape} w={spec.w} h={spec.h} label={quote ? `${quote.text} ${quote.author}` : "Quote"}>
      {quote ? <QuoteBody quote={quote} size={size} /> : <WidgetNotice title="Quote" issue="needs-setup" message="Add quotes in settings" />}
    </Surface>
  );
}

export const quoteWidget = defineWidget<QuoteConfig>({
  id: "quote",
  name: "Quote",
  description: "A public-domain quote that changes daily or hourly, with its source. Add your own list too.",
  category: "info",
  sizes: QUOTE_SIZES,
  providers: [],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: QUOTE_SCHEMA,
  component: ({ config, size }: WidgetProps<QuoteConfig>) => <QuoteWidget size={size} config={config} />,
});
