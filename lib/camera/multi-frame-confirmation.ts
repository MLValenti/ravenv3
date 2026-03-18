export class MultiFrameConfirmation {
  private readonly windowSize: number;
  private readonly requiredPasses: number;
  private readonly values: boolean[] = [];

  constructor(windowSize: number, requiredPasses: number) {
    this.windowSize = windowSize;
    this.requiredPasses = requiredPasses;
  }

  push(value: boolean): { passed: boolean; passCount: number; windowSize: number; requiredPasses: number } {
    this.values.push(value);
    if (this.values.length > this.windowSize) {
      this.values.shift();
    }

    const passCount = this.values.filter(Boolean).length;
    return {
      passed: passCount >= this.requiredPasses,
      passCount,
      windowSize: this.windowSize,
      requiredPasses: this.requiredPasses,
    };
  }
}
