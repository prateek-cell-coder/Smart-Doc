namespace smart.doc.ai;

using { cuid, managed } from '@sap/cds/common';

// ── Main document entity ──
entity Document : cuid, managed {
    fileName         : String(255);
    fileType         : String(20);      // PDF, DOCX, PPTX, XLSX
    fileSize         : Integer;
    originalLanguage : String(50);      // Detected language
    status           : String(20) default 'UPLOADED';  // UPLOADED, ANALYZING, DONE, ERROR
    originalContent  : LargeString;     // Raw extracted text
    translatedContent: LargeString;     // English translation
    summary          : LargeString;     // AI generated summary
    extractedFields  : LargeString;     // JSON string of extracted fields
    uploadedBy       : String(100);
    fields           : Composition of many ExtractedField on fields.document = $self;
    conversations    : Composition of many QAConversation on conversations.document = $self;
}

// ── Extracted key fields ──
entity ExtractedField : cuid {
    document   : Association to Document;
    fieldName  : String(100);    // date, amount, person, organization etc.
    fieldValue : String(500);
    fieldType  : String(50);     // DATE, AMOUNT, PERSON, ORGANIZATION, OTHER
}

// ── Q&A Conversation history ──
entity QAConversation : cuid {
    document   : Association to Document;
    question   : LargeString;
    answer     : LargeString;
    askedAt    : DateTime;
}