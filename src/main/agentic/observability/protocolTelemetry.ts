export interface ProtocolTurnTelemetryInput {
  validEnvelope: boolean;
  repairAttempted: boolean;
  fallbackUsed: boolean;
  blockedActions: number;
}

export interface ProtocolTelemetrySnapshot {
  totalTurns: number;
  validEnvelopeTurns: number;
  repairAttempts: number;
  fallbackTurns: number;
  blockedActionCount: number;
  parseValidityRate: number;
  repairRate: number;
  fallbackRate: number;
}

export class ProtocolTelemetryService {
  private totalTurns = 0;
  private validEnvelopeTurns = 0;
  private repairAttempts = 0;
  private fallbackTurns = 0;
  private blockedActionCount = 0;

  recordTurn(input: ProtocolTurnTelemetryInput): void {
    this.totalTurns += 1;
    if (input.validEnvelope) {
      this.validEnvelopeTurns += 1;
    }
    if (input.repairAttempted) {
      this.repairAttempts += 1;
    }
    if (input.fallbackUsed) {
      this.fallbackTurns += 1;
    }
    this.blockedActionCount += input.blockedActions;
  }

  getSnapshot(): ProtocolTelemetrySnapshot {
    const denominator = this.totalTurns || 1;
    return {
      totalTurns: this.totalTurns,
      validEnvelopeTurns: this.validEnvelopeTurns,
      repairAttempts: this.repairAttempts,
      fallbackTurns: this.fallbackTurns,
      blockedActionCount: this.blockedActionCount,
      parseValidityRate: this.validEnvelopeTurns / denominator,
      repairRate: this.repairAttempts / denominator,
      fallbackRate: this.fallbackTurns / denominator,
    };
  }
}

let protocolTelemetryService: ProtocolTelemetryService | null = null;

export function getProtocolTelemetryService(): ProtocolTelemetryService {
  if (!protocolTelemetryService) {
    protocolTelemetryService = new ProtocolTelemetryService();
  }

  return protocolTelemetryService;
}
