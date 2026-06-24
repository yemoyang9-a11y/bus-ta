/** system_logs 테이블 접근 인터페이스 */
export interface SystemLogRepository {
  log(entry: {
    level: "info" | "warn" | "error";
    message: string;
    context?: Record<string, unknown>;
    timestamp?: string;
  }): Promise<void>;
}

// TODO: Supabase 구현체 추가
