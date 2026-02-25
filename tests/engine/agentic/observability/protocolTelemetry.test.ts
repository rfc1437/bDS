import { describe, expect, it } from 'vitest';
import { ProtocolTelemetryService } from '../../../../src/main/agentic/observability/protocolTelemetry';

describe('ProtocolTelemetryService', () => {
  it('tracks parse validity, repairs, fallback, and blocked actions', () => {
    const telemetry = new ProtocolTelemetryService();

    telemetry.recordTurn({
      validEnvelope: true,
      repairAttempted: false,
      fallbackUsed: false,
      blockedActions: 0,
    });

    telemetry.recordTurn({
      validEnvelope: true,
      repairAttempted: true,
      fallbackUsed: false,
      blockedActions: 1,
    });

    telemetry.recordTurn({
      validEnvelope: false,
      repairAttempted: true,
      fallbackUsed: true,
      blockedActions: 2,
    });

    const snapshot = telemetry.getSnapshot();

    expect(snapshot.totalTurns).toBe(3);
    expect(snapshot.validEnvelopeTurns).toBe(2);
    expect(snapshot.repairAttempts).toBe(2);
    expect(snapshot.fallbackTurns).toBe(1);
    expect(snapshot.blockedActionCount).toBe(3);
    expect(snapshot.parseValidityRate).toBeCloseTo(2 / 3, 5);
  });
});
