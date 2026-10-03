import { useLayoutEffect, useRef } from "react";

const MAX_HEIGHT = 120;

// Message box that wraps onto new lines and grows as you type (up to a
// limit). Enter sends, Shift+Enter inserts a line break.
export default function ChatInput({
  value,
  onChange,
  onSend,
  placeholder,
  autoFocus = false,
  maxLength = 1000,
}) {
  const ref = useRef(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "auto";
    // border-box sizing: scrollHeight leaves out the border, so add it back.
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${Math.min(element.scrollHeight + border, MAX_HEIGHT)}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onSend();
        }
      }}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label="Message"
      autoFocus={autoFocus}
    />
  );
}
