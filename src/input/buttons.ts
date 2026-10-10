export type Button = "A" | "B" | "C";

export function handleKey(key: string): Button | null {
  switch (key) {
    case "a": case "A": case "ArrowLeft": return "A";
    case "Enter": case " ": return "B";
    case "Escape": case "ArrowRight": return "C";
    default: return null;
  }
}
