/**
 * 후보 안내 응답의 생성 완료와 실제 오디오 출력 완료를 함께 추적한다.
 *
 * response.done은 모델이 응답 생성을 끝냈다는 뜻이고, WebRTC 출력 버퍼가
 * 아직 재생 중일 수 있다. 오디오가 시작된 응답은 output_audio_buffer.stopped까지
 * 확인한 뒤에만 후보를 안내 완료로 처리한다.
 */
export class CandidateAnnouncementTracker {
  private activeCandidateIds: number[] = [];
  private completedCandidateIds = new Set<number>();
  private responseCompleted = false;
  private outputAudioStarted = false;
  private outputAudioActive = false;

  startResponse(candidateIds: number[] | undefined) {
    this.clearActiveResponse();

    this.activeCandidateIds = [
      ...new Set(candidateIds ?? []),
    ].filter(
      (candidateId) =>
        !this.completedCandidateIds.has(candidateId),
    );
  }

  handleServerEvent(event: unknown): number[] {
    if (event == null || typeof event !== "object") {
      return [];
    }

    const value = event as Record<string, unknown>;

    if (value.type === "output_audio_buffer.started") {
      this.handleOutputAudioStarted();
      return [];
    }

    if (value.type === "output_audio_buffer.stopped") {
      return this.handleOutputAudioStopped();
    }

    if (value.type !== "response.done") {
      return [];
    }

    const response = value.response as Record<string, unknown> | undefined;
    return this.handleResponseDone(
      typeof response?.status === "string"
        ? response.status
        : undefined,
    );
  }

  private handleOutputAudioStarted() {
    if (this.activeCandidateIds.length === 0) {
      return;
    }

    this.outputAudioStarted = true;
    this.outputAudioActive = true;
  }

  private handleOutputAudioStopped(): number[] {
    this.outputAudioActive = false;
    return this.finishIfReady();
  }

  private handleResponseDone(status: string | undefined): number[] {
    if (status !== "completed") {
      this.clearActiveResponse();
      return [];
    }

    this.responseCompleted = true;
    return this.finishIfReady();
  }

  cancelResponse() {
    this.clearActiveResponse();
  }

  resetForNewSearch() {
    this.completedCandidateIds.clear();
    this.clearActiveResponse();
  }

  private finishIfReady(): number[] {
    if (
      !this.responseCompleted ||
      (this.outputAudioStarted && this.outputAudioActive)
    ) {
      return [];
    }

    const completed = this.activeCandidateIds.filter(
      (candidateId) =>
        !this.completedCandidateIds.has(candidateId),
    );

    for (const candidateId of completed) {
      this.completedCandidateIds.add(candidateId);
    }

    this.clearActiveResponse();
    return completed;
  }

  private clearActiveResponse() {
    this.activeCandidateIds = [];
    this.responseCompleted = false;
    this.outputAudioStarted = false;
    this.outputAudioActive = false;
  }
}
