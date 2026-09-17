export const ERROR_CODES = [
  'NO_DOCUMENT',
  'INVALID_LAYER_SELECTION',
  'UNSUPPORTED_LAYER',
  'UNSUPPORTED_DOCUMENT',
  'EMPTY_LAYER',
  'OUT_OF_CANVAS_UNSUPPORTED',
  'BRIDGE_OFFLINE',
  'UNAUTHORIZED',
  'HOST_REJECTED',
  'ORIGIN_REJECTED',
  'CONTENT_TYPE',
  'INVALID_LENGTH',
  'INVALID_DIMENSIONS',
  'IMAGE_TOO_LARGE',
  'ANIMATED_IMAGE',
  'INVALID_IMAGE',
  'ASSET_NOT_FOUND',
  'ASSET_IN_USE',
  'MEMORY_LIMIT',
  'BUSY',
  'IDEMPOTENCY_CONFLICT',
  'INVALID_REQUEST',
  'UNSUPPORTED_MODE',
  'MODEL_NOT_ADAPTED',
  'MODEL_NOT_VISIBLE',
  'FIELD_NOT_ALLOWED',
  'EDIT_NOT_AVAILABLE',
  'TEXT_NOT_AVAILABLE',
  'SOURCE_UPLOAD_UNVERIFIED',
  'IMAGE_EDIT_UNVERIFIED',
  'MISSING_SOURCE_COLOR',
  'OUTPUT_INVALID',
  'OUTPUT_GEOMETRY_MISMATCH',
  'PROVIDER_AUTH',
  'PROVIDER_QUOTA',
  'PROVIDER_RATE_LIMIT',
  'REQUEST_STATUS_UNKNOWN',
  'BUDGET_EXCEEDED',
  'COST_UNKNOWN',
  'SOURCE_CHANGED',
  'TARGET_CLOSED',
  'HOST_BUSY',
  'WRITEBACK_FAILED',
  'USER_CANCELLED',
  'NOT_FOUND',
  'VERSION_INCOMPATIBLE',
  'INTERNAL',
  'MOCK_FAILURE',
  'SSRF_REJECTED',
  'DOWNLOAD_TOO_LARGE',
  'PROMPT_REQUIRED'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly retryable: boolean;
  readonly jobId?: string;
  readonly requestId?: string;

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    options: { retryable?: boolean; jobId?: string; requestId?: string } = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.retryable = options.retryable === true;
    if (options.jobId !== undefined) this.jobId = options.jobId;
    if (options.requestId !== undefined) this.requestId = options.requestId;
  }

  toJSON(): { error: { code: ErrorCode; message: string; retryable: boolean; jobId?: string; requestId?: string } } {
    const error: { code: ErrorCode; message: string; retryable: boolean; jobId?: string; requestId?: string } = {
      code: this.code,
      message: this.message,
      retryable: this.retryable
    };
    if (this.jobId !== undefined) error.jobId = this.jobId;
    if (this.requestId !== undefined) error.requestId = this.requestId;
    return { error };
  }
}
