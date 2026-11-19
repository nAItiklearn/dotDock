import { DotMatrix } from "../design-system/DotMatrix";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { FACTS } from "./data/facts";
import { defineWidget, type WidgetProps } from "./definition";
import { pad2 } from "./format";
import { rotationIndex, rotationTick, type RotationPeriod } from "./rotation";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import "./FunFactWidget.css";

export interface FunFactConfig {
  readonly rotation: RotationPeriod;
}

export const FUN_FACT_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Card", w: 4, h: 2 },
  { id: "l", name: "Poster", w: 4, h: 4 },
];

const FUN_FACT_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rotation: {
      type: "string",
      title: "Change fact",
      default: "daily",
      oneOf: [
        { const: "daily", title: "Every day" },
        { const: "hourly", title: "Every hour" },
      ],
    },
  },
};

const SALT = 29;
const POSTER_NUMBER_HEIGHT = 48;

export function FunFactWidget({ size = "m", config = { rotation: "daily" } }: { readonly size?: SizeId; readonly config?: FunFactConfig }) {
  const now = useMinute();
  const spec = sizeSpec(FUN_FACT_SIZES, size);
  const index = rotationIndex(FACTS.length, rotationTick(now, config.rotation), SALT);
  const fact = FACTS[index];
  if (!fact) return null;
  const number = pad2(index + 1);
  return (
    <Surface shape="card" w={spec.w} h={spec.h} label={`Fun fact: ${fact.text}`}>
      <article className={`fact fact--${size}`}>
        <header className="fact__head">
          <span className="fact__title">
            <span className="fact__marker" aria-hidden="true" />
            <Caps>Fun fact</Caps>
          </span>
          {size === "l" ? (
            <DotMatrix text={number} matrixStyle="dots" height={POSTER_NUMBER_HEIGHT} label={`Fact ${index + 1} of ${FACTS.length}`} />
          ) : (
            <span className="fact__index tabular">
              {number} / {FACTS.length}
            </span>
          )}
        </header>
        <p className="fact__text">{fact.text}</p>
        <footer className="fact__source">
          <Caps>{fact.source}</Caps>
        </footer>
      </article>
    </Surface>
  );
}

export const funFactWidget = defineWidget<FunFactConfig>({
  id: "fun-fact",
  name: "Fun fact",
  description: "A short true fact with its source, from a bundled set that works offline.",
  category: "info",
  sizes: FUN_FACT_SIZES,
  providers: [],
  defaultConfig: { rotation: "daily" },
  settingsSchema: FUN_FACT_SCHEMA,
  component: ({ config, size }: WidgetProps<FunFactConfig>) => <FunFactWidget size={size} config={config} />,
});
