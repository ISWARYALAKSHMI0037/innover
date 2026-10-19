import mongoose from 'mongoose';

const { Schema } = mongoose;

const ProgressStep = new Schema(
  {
    key: String,
    label: String,
    status: { type: String, enum: ['pending', 'running', 'done', 'failed', 'skipped'], default: 'pending' },
    note: String,
  },
  { _id: false },
);

const AnalysisSchema = new Schema(
  {
    clientId: { type: String, required: true, index: true },
    isSample: { type: Boolean, default: false, index: true },
    college: { type: String, trim: true, maxlength: 80, index: true },
    shareWithCampus: { type: Boolean, default: true },
    language: { type: String, enum: ['en', 'ta'], default: 'en' },

    status: { type: String, enum: ['processing', 'complete', 'failed'], default: 'processing', index: true },
    progress: [ProgressStep],
    errorCode: String,
    errorMessage: String,

    source: {
      type: { type: String, enum: ['text', 'pdf', 'image'] },
      fileName: String,
      mimeType: String,
      sizeBytes: Number,
      textOrigin: String, // provided | llm-transcription
      textLength: Number,
      model: String,
    },
    rawText: { type: String, maxlength: 30000 },

    extraction: Schema.Types.Mixed,
    droppedUngrounded: [String],
    verification: Schema.Types.Mixed,
    report: Schema.Types.Mixed,

    // Top-level copies used for listing/filtering
    riskLevel: { type: String, enum: ['Low', 'Medium', 'High'], index: true },
    riskScore: Number,
    companyName: String,
    jobTitle: String,
    senderEmail: String,

    // Compact, non-identifying facts used for campus-level statistics
    stats: {
      signalIds: [String],
      signalTitles: [String],
      paymentRequested: Boolean,
      paymentCategories: [String],
      freeEmail: Boolean,
      senderDomain: String,
      senderDomainAgeDays: Number,
      confidence: String,
    },
  },
  { timestamps: true },
);

AnalysisSchema.index({ clientId: 1, createdAt: -1 });
AnalysisSchema.index({ shareWithCampus: 1, status: 1, isSample: 1, createdAt: -1 });

export const Analysis = mongoose.model('Analysis', AnalysisSchema);

/** Shape used for list views (no raw text / evidence). */
export function toSummary(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(o._id),
    createdAt: o.createdAt,
    status: o.status,
    riskLevel: o.riskLevel || null,
    riskScore: o.riskScore ?? null,
    companyName: o.companyName || null,
    jobTitle: o.jobTitle || null,
    senderEmail: o.senderEmail || null,
    sourceType: o.source?.type || null,
    fileName: o.source?.fileName || null,
    language: o.language,
    isSample: !!o.isSample,
    errorMessage: o.status === 'failed' ? o.errorMessage : undefined,
    signalCount: o.stats?.signalIds?.length || 0,
    paymentRequested: !!o.stats?.paymentRequested,
  };
}

export function toDetail(doc) {
  const o = doc.toObject ? doc.toObject() : doc;
  return {
    ...toSummary(o),
    college: o.college || null,
    shareWithCampus: o.shareWithCampus,
    progress: o.progress,
    errorCode: o.errorCode,
    source: o.source,
    rawText: o.rawText,
    extraction: o.extraction,
    droppedUngrounded: o.droppedUngrounded,
    verification: o.verification,
    report: o.report,
  };
}
