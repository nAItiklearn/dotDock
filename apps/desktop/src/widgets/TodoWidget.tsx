import { useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "../design-system/Icon";
import { Caps, Surface } from "../design-system/primitives";
import { useMinute } from "../providers/clock";
import type { ConfigSchema } from "./configSchema";
import { defineWidget, type WidgetProps } from "./definition";
import { relativeDayLabel } from "./format";
import { sizeSpec, type SizeId, type SizeSpec } from "./sizes";
import { dueState, displayOrder, formatDue, MAX_TEXT_LENGTH, parseDue, type TodoItem } from "./todoModel";
import { useTodoStore } from "./todoStore";
import "./TodoWidget.css";

export interface TodoConfig {
  readonly showDone: boolean;
  readonly showDueDates: boolean;
}

export const TODO_SIZES: readonly SizeSpec[] = [
  { id: "m", name: "Compact", w: 4, h: 2 },
  { id: "l", name: "List", w: 4, h: 4 },
];

const TODO_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    showDone: { type: "boolean", title: "Show finished tasks", default: true },
    showDueDates: { type: "boolean", title: "Show due dates", default: true },
  },
};

const DEFAULT_CONFIG: TodoConfig = { showDone: true, showDueDates: true };

interface DragState {
  readonly id: string;
  readonly from: number;
  readonly dy: number;
}

function dueLabel(item: TodoItem, now: Date): string | null {
  const date = item.due ? parseDue(item.due) : null;
  return date ? relativeDayLabel(date, now) : null;
}

function DueChip({ item, now }: { readonly item: TodoItem; readonly now: Date }) {
  const setDue = useTodoStore((s) => s.setDue);
  const input = useRef<HTMLInputElement>(null);
  const label = dueLabel(item, now);
  const state = item.done ? null : dueState(item.due, now);
  return (
    <span className="todo__due-wrap">
      <button
        type="button"
        className={`todo__due${label ? "" : " todo__due--empty"}${state ? ` todo__due--${state}` : ""}`}
        aria-label={label ? `Due ${label}. Change date` : "Set a due date"}
        onClick={() => input.current?.showPicker()}
      >
        {label ?? "Due"}
      </button>
      <input
        ref={input}
        className="todo__date"
        name="due-date"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={item.due ?? ""}
        min={formatDue(now)}
        onChange={(e) => setDue(item.id, e.target.value === "" ? null : e.target.value)}
      />
    </span>
  );
}

interface RowProps {
  readonly item: TodoItem;
  readonly index: number;
  readonly openCount: number;
  readonly now: Date;
  readonly showDue: boolean;
  readonly drag: DragState | null;
  readonly target: number;
  readonly rowHeight: number;
  readonly onGripDown: (e: PointerEvent<HTMLButtonElement>, index: number, id: string) => void;
  readonly onGripMove: (e: PointerEvent<HTMLButtonElement>) => void;
  readonly onGripEnd: (e: PointerEvent<HTMLButtonElement>) => void;
}

function Row({ item, index, openCount, now, showDue, drag, target, rowHeight, onGripDown, onGripMove, onGripEnd }: RowProps) {
  const { toggle, remove, reorder } = useTodoStore();
  const dragging = drag?.id === item.id;
  let shift = 0;
  if (drag && !dragging && !item.done) {
    if (drag.from < index && index <= target) shift = -rowHeight;
    else if (target <= index && index < drag.from) shift = rowHeight;
  }
  const offset = dragging ? drag.dy : shift;
  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    reorder(index, e.key === "ArrowUp" ? index - 1 : index + 1);
  };
  return (
    <li
      className={`todo__row${item.done ? " todo__row--done" : ""}${dragging ? " todo__row--dragging" : ""}`}
      style={offset === 0 ? undefined : { transform: `translateY(${offset}px)` }}
    >
      {item.done || openCount < 2 ? (
        <span className="todo__grip-space" aria-hidden="true" />
      ) : (
        <button
          type="button"
          className="todo__grip"
          aria-label={`Reorder ${item.text}. Hold Alt and press the arrow keys, or drag.`}
          onPointerDown={(e) => onGripDown(e, index, item.id)}
          onPointerMove={onGripMove}
          onPointerUp={onGripEnd}
          onPointerCancel={onGripEnd}
          onKeyDown={onGripKey}
        >
          <Icon name="grip" />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.text}
        className="todo__check"
        onClick={() => toggle(item.id)}
      >
        <span className="todo__check-fill" />
        <Icon name="check" className="todo__check-mark" />
      </button>
      <span className="todo__text">{item.text}</span>
      {showDue ? <DueChip item={item} now={now} /> : null}
      <button type="button" className="todo__remove" aria-label={`Delete ${item.text}`} onClick={() => remove(item.id)}>
        <Icon name="cross" />
      </button>
    </li>
  );
}

function AddField() {
  const add = useTodoStore((s) => s.add);
  const [text, setText] = useState("");
  const submit = (e: FormEvent): void => {
    e.preventDefault();
    add(text);
    setText("");
  };
  return (
    <form className="todo__add" onSubmit={submit}>
      <Icon name="plus" className="todo__add-icon" />
      <input
        className="todo__input"
        name="new-task"
        value={text}
        maxLength={MAX_TEXT_LENGTH}
        placeholder="Add a task"
        aria-label="New task"
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

export function TodoWidget({ size = "m", config = DEFAULT_CONFIG }: { readonly size?: SizeId; readonly config?: TodoConfig }) {
  const { items, clearDone, reorder } = useTodoStore();
  const now = useMinute();
  const spec = sizeSpec(TODO_SIZES, size);
  const [drag, setDrag] = useState<DragState | null>(null);
  const startY = useRef(0);
  const rowHeight = useRef(0);

  const ordered = displayOrder(items);
  const openCount = items.filter((i) => !i.done).length;
  const doneCount = items.length - openCount;
  const visible = config.showDone ? ordered : ordered.filter((i) => !i.done);
  const target = drag ? Math.min(openCount - 1, Math.max(0, Math.round(drag.from + drag.dy / (rowHeight.current || 1)))) : 0;

  const onGripDown = (e: PointerEvent<HTMLButtonElement>, index: number, id: string): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    rowHeight.current = e.currentTarget.closest("li")?.offsetHeight ?? 0;
    startY.current = e.clientY;
    setDrag({ id, from: index, dy: 0 });
  };
  const onGripMove = (e: PointerEvent<HTMLButtonElement>): void => {
    if (drag) setDrag({ ...drag, dy: e.clientY - startY.current });
  };
  const onGripEnd = (): void => {
    if (drag && target !== drag.from) reorder(drag.from, target);
    setDrag(null);
  };

  return (
    <Surface shape="card" w={spec.w} h={spec.h} label="To-do" className={`todo todo--${size}`}>
      <div className="todo__layout">
        <header className="todo__head">
          <span className="todo__title">
            <span className="todo__marker" aria-hidden="true" />
            <Caps>To-do</Caps>
          </span>
          <span className="todo__summary">
            <Caps>{items.length === 0 ? "No tasks" : openCount === 0 ? "All done" : `${openCount} open`}</Caps>
            {doneCount > 0 ? (
              <button type="button" className="todo__clear" onClick={clearDone}>
                <Caps>Clear done</Caps>
              </button>
            ) : null}
          </span>
        </header>
        {visible.length === 0 ? (
          <div className="todo__empty">
            <Icon name="check" className="todo__empty-icon" />
            <span>{items.length === 0 ? "Nothing to do yet" : "Everything is finished"}</span>
          </div>
        ) : (
          <ul className="todo__list">
            {visible.map((item, i) => (
              <Row
                key={item.id}
                item={item}
                index={i}
                openCount={openCount}
                now={now}
                showDue={config.showDueDates}
                drag={drag}
                target={target}
                rowHeight={rowHeight.current}
                onGripDown={onGripDown}
                onGripMove={onGripMove}
                onGripEnd={onGripEnd}
              />
            ))}
          </ul>
        )}
        <AddField />
      </div>
    </Surface>
  );
}

export const todoWidget = defineWidget<TodoConfig>({
  id: "todo",
  name: "To-do",
  description: "A local task list. Tick things off, drag to reorder, set due dates.",
  category: "productivity",
  sizes: TODO_SIZES,
  providers: [],
  defaultConfig: DEFAULT_CONFIG,
  settingsSchema: TODO_SCHEMA,
  component: ({ config, size }: WidgetProps<TodoConfig>) => <TodoWidget size={size} config={config} />,
});
