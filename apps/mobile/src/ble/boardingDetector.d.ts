export type BoardingDetectionConfig = {
  rssiThreshold: number;
  requiredDurationMs: number;
  toleratedDropCount: number;
  maxSampleGapMs: number;
};
export const BOARDING_DETECTION_CONFIG: BoardingDetectionConfig;
export function createBoardingDetector(config?: Partial<BoardingDetectionConfig>): {
  ingest(sample: { rssi: number; beaconId?: string; timestamp?: number }): void;
  reset(): void;
  onConfirmed(callback: (sample: { rssi: number; beaconId?: string; detectedAt: string }) => void): void;
};
