export class SemanticGuideError extends Error {
  constructor(code, message, requestId = null) {
    super(message);
    this.code = code;
    this.requestId = requestId;
  }
}
