/** IME confirmation keys must not submit a draft or trigger task shortcuts. */
export function isComposing(event: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  const native = event.nativeEvent ?? event;
  return native.isComposing === true || native.keyCode === 229;
}
