// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusField } from "./useFocusField";

function Panel({ withField = true }: { readonly withField?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusField(ref);
  return (
    <div ref={ref}>
      <button type="button">inside</button>
      {withField ? <input aria-label="field" data-focus-field /> : null}
    </div>
  );
}

afterEach(cleanup);

describe("useFocusField", () => {
  it("puts the keyboard in the marked field when the panel opens", () => {
    const { getByLabelText } = render(<Panel />);
    expect(document.activeElement).toBe(getByLabelText("field"));
  });

  it("takes it back when the window gets the keyboard and focus had gone back to the item that was clicked", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    const { getByLabelText } = render(<Panel />);
    outside.focus();
    window.dispatchEvent(new Event("focus"));
    expect(document.activeElement).toBe(getByLabelText("field"));
    outside.remove();
  });

  it("takes it back when the press that opened the panel ends, after the pressed item took focus", () => {
    const pressed = document.createElement("button");
    document.body.append(pressed);
    const { getByLabelText } = render(<Panel />);
    pressed.focus();
    window.dispatchEvent(new Event("pointerup"));
    expect(document.activeElement).toBe(getByLabelText("field"));
    pressed.remove();
  });

  it("leaves focus alone while it is already inside the panel, and in panels with no field", () => {
    const { getByText } = render(<Panel />);
    getByText("inside").focus();
    window.dispatchEvent(new Event("focus"));
    expect(document.activeElement).toBe(getByText("inside"));
    cleanup();
    render(<Panel withField={false} />);
    expect(document.activeElement).toBe(document.body);
  });
});
