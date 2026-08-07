/**
 * Single-line console progress. On a TTY it rewrites one line in place; piped
 * to a file it prints occasional milestones instead of thousands of updates.
 */
export class ProgressBar {
  private readonly tty: boolean;
  private lastRendered = -1;
  private lastLineLength = 0;

  constructor(private label: string) {
    this.tty = process.stdout.isTTY === true;
  }

  setLabel(label: string): void {
    this.label = label;
    this.lastRendered = -1;
  }

  update(done: number, total: number): void {
    const share = total > 0 ? Math.min(1, done / total) : 0;
    const percent = Math.floor(share * 100);
    if (this.tty) {
      if (percent === this.lastRendered) return;
      this.lastRendered = percent;
      const width = 24;
      const filled = Math.round(share * width);
      const bar = "█".repeat(filled) + "░".repeat(width - filled);
      this.write(`${this.label} ${bar} ${String(percent).padStart(3)}%`);
      return;
    }
    // Non-TTY: one line every 25%.
    const milestone = Math.floor(share * 4);
    if (milestone === this.lastRendered) return;
    this.lastRendered = milestone;
    console.log(`${this.label} ${percent}%`);
  }

  /** Clears the live line and prints a permanent one. */
  finish(message: string): void {
    if (this.tty) {
      this.write("");
      process.stdout.write("\r");
    }
    console.log(message);
    this.lastRendered = -1;
    this.lastLineLength = 0;
  }

  private write(text: string): void {
    const padded = text.padEnd(this.lastLineLength);
    process.stdout.write(`\r${padded}`);
    this.lastLineLength = text.length;
  }
}
