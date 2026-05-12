sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], (Controller, JSONModel, MessageToast, MessageBox) => {
    "use strict";

    return Controller.extend("com.bosch.smartdoc.project1.controller.smartdoc", {

        onInit() {
            this.getView().setModel(new JSONModel({
                fileSelected       : false,
                documentAnalyzed   : false,
                showSummary        : false,
                showTranslation    : false,
                detectedLanguage   : '',
                originalContent    : '',
                translatedContent  : '',
                summary            : '',
                extractedFields    : [],
                qaHistory          : [],
                currentDocumentId  : null
            }), "appModel");

            this.getView().setModel(new JSONModel({ results: [] }), "historyModel");

            const oInput         = document.createElement("input");
            oInput.type          = "file";
            oInput.accept        = ".pdf,.docx,.pptx,.xlsx";
            oInput.style.display = "none";
            oInput.id            = "__smartDocFileInput";
            oInput.addEventListener("change", this._onFileSelected.bind(this));
            document.body.appendChild(oInput);

            this._loadHistory();
        },

        onChooseFile() {
            document.getElementById("__smartDocFileInput").click();
        },

        _onFileSelected(oEvent) {
            const oFile = oEvent.target.files[0];
            if (!oFile) return;
            oEvent.target.value = "";

            this._selectedFile = oFile;
            this.byId("selectedFileName").setText(`📄 ${oFile.name} (${(oFile.size / 1024).toFixed(1)} KB)`);
            this.getView().getModel("appModel").setProperty("/fileSelected", true);
            MessageToast.show("File selected! Click Analyze Document to proceed.");
        },

        onAnalyzeDocument() {
            if (!this._selectedFile) {
                MessageBox.warning("Please select a file first.");
                return;
            }

            const oView = this.getView();
            oView.setBusy(true);

            const oReader = new FileReader();
            oReader.onload = async (e) => {
                try {
                    const base64Content = btoa(
                        new Uint8Array(e.target.result)
                            .reduce((data, byte) => data + String.fromCharCode(byte), '')
                    );

                    const fileType = this._selectedFile.name.split('.').pop().toUpperCase();

                    const response = await fetch("/smartdoc/uploadDocument", {
                        method  : "POST",
                        headers : {
                            "Content-Type" : "application/json",
                            "Accept"       : "application/json"
                        },
                        body : JSON.stringify({
                            fileName    : this._selectedFile.name,
                            fileType    : fileType,
                            fileContent : base64Content
                        })
                    });

                    if (!response.ok) {
                        const err = await response.text();
                        throw new Error(`HTTP ${response.status}: ${err}`);
                    }

                    const data   = await response.json();
                    const result = data.value || data;

                    oView.setBusy(false);

                    if (result.success) {
                        const oModel = oView.getModel("appModel");
                        oModel.setProperty("/currentDocumentId", result.documentId);
                        oModel.setProperty("/documentAnalyzed", true);
                        oModel.setProperty("/detectedLanguage", result.message);

                        await this._loadExtractedFields(result.documentId);

                        this.byId("statusBox").setVisible(true);
                        this.byId("statusText").setText(`✅ ${result.message}`);

                        MessageBox.success(result.message);
                        this._loadHistory();
                    } else {
                        MessageBox.error(result.message || "Analysis failed.");
                    }

                } catch (err) {
                    oView.setBusy(false);
                    console.error("Analysis error:", err.message);
                    MessageBox.error("Error: " + err.message);
                }
            };

            oReader.readAsArrayBuffer(this._selectedFile);
        },

        async _loadExtractedFields(documentId) {
            try {
                const response = await fetch(
                    `/smartdoc/ExtractedFields?$filter=document_ID eq ${documentId}&$format=json`
                );
                const data   = await response.json();
                const fields = data.value || [];
                this.getView().getModel("appModel").setProperty("/extractedFields", fields);
            } catch (err) {
                console.error("Failed to load fields:", err.message);
            }
        },

        async onTranslate() {
            const oModel     = this.getView().getModel("appModel");
            const documentId = oModel.getProperty("/currentDocumentId");

            if (!documentId) {
                MessageBox.warning("Please analyze a document first.");
                return;
            }

            this.getView().setBusy(true);

            try {
                const response = await fetch("/smartdoc/translateDocument", {
                    method  : "POST",
                    headers : {
                        "Content-Type" : "application/json",
                        "Accept"       : "application/json"
                    },
                    body : JSON.stringify({
                        documentId : documentId,
                        targetLang : "English"
                    })
                });

                const data   = await response.json();
                const result = data.value || data;

                this.getView().setBusy(false);

                if (result.success) {
                    oModel.setProperty("/translatedContent", result.translatedContent);
                    oModel.setProperty("/showTranslation", true);
                    await this._loadOriginalContent(documentId);
                    MessageToast.show("Translation completed!");
                } else {
                    MessageBox.error(result.message || "Translation failed.");
                }

            } catch (err) {
                this.getView().setBusy(false);
                MessageBox.error("Translation error: " + err.message);
            }
        },

        async _loadOriginalContent(documentId) {
            try {
                const response = await fetch(`/smartdoc/Documents(${documentId})?$format=json`);
                const data     = await response.json();
                this.getView().getModel("appModel").setProperty("/originalContent", data.originalContent || '');
            } catch (err) {
                console.error("Failed to load original content:", err.message);
            }
        },

        async onSummarize() {
            const oModel     = this.getView().getModel("appModel");
            const documentId = oModel.getProperty("/currentDocumentId");

            if (!documentId) {
                MessageBox.warning("Please analyze a document first.");
                return;
            }

            this.getView().setBusy(true);

            try {
                const response = await fetch("/smartdoc/summarizeDocument", {
                    method  : "POST",
                    headers : {
                        "Content-Type" : "application/json",
                        "Accept"       : "application/json"
                    },
                    body : JSON.stringify({ documentId: documentId })
                });

                const data   = await response.json();
                const result = data.value || data;

                this.getView().setBusy(false);

                if (result.success) {
                    oModel.setProperty("/summary", result.summary);
                    oModel.setProperty("/showSummary", true);
                    MessageToast.show("Summary generated!");
                } else {
                    MessageBox.error(result.message || "Summarization failed.");
                }

            } catch (err) {
                this.getView().setBusy(false);
                MessageBox.error("Summary error: " + err.message);
            }
        },

        async onAskQuestion() {
            const oModel     = this.getView().getModel("appModel");
            const documentId = oModel.getProperty("/currentDocumentId");
            const question   = this.byId("questionInput").getValue().trim();

            if (!documentId) {
                MessageBox.warning("Please analyze a document first.");
                return;
            }

            if (!question) {
                MessageToast.show("Please type a question.");
                return;
            }

            this.getView().setBusy(true);

            try {
                const response = await fetch("/smartdoc/askQuestion", {
                    method  : "POST",
                    headers : {
                        "Content-Type" : "application/json",
                        "Accept"       : "application/json"
                    },
                    body : JSON.stringify({
                        documentId : documentId,
                        question   : question
                    })
                });

                const data   = await response.json();
                const result = data.value || data;

                this.getView().setBusy(false);

                if (result.success) {
                    const qaHistory = oModel.getProperty("/qaHistory");
                    qaHistory.unshift({
                        question : question,
                        answer   : result.answer
                    });
                    oModel.setProperty("/qaHistory", qaHistory);
                    this.byId("questionInput").setValue("");
                } else {
                    MessageBox.error(result.message || "Failed to answer question.");
                }

            } catch (err) {
                this.getView().setBusy(false);
                MessageBox.error("Q&A error: " + err.message);
            }
        },

        // ── ✅ NEW: Export Extracted Fields to Excel ──
        onExportFields() {
            const aFields = this.getView().getModel("appModel").getProperty("/extractedFields");
            if (!aFields || aFields.length === 0) {
                MessageToast.show("No extracted fields to export.");
                return;
            }

            const XLSX = window.XLSX;
            if (!XLSX) {
                MessageBox.error("SheetJS library not loaded. Check index.html.");
                return;
            }

            const aRows = aFields.map(f => ({
                "Field Name" : f.fieldName  || '',
                "Value"      : f.fieldValue || '',
                "Type"       : f.fieldType  || ''
            }));

            const ws = XLSX.utils.json_to_sheet(aRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Extracted Fields");
            XLSX.writeFile(wb, "SmartDoc_ExtractedFields.xlsx");
            MessageToast.show("Extracted fields exported successfully!");
        },

        // ── ✅ NEW: Export Summary to Text File ──
        onExportSummary() {
            const sSummary = this.getView().getModel("appModel").getProperty("/summary");
            if (!sSummary) {
                MessageToast.show("No summary to export.");
                return;
            }

            const blob = new Blob([sSummary], { type: 'text/plain' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = "SmartDoc_Summary.txt";
            a.click();
            URL.revokeObjectURL(url);
            MessageToast.show("Summary exported successfully!");
        },

        // ── ✅ NEW: Export Translation to Text File ──
        onExportTranslation() {
            const sTranslation = this.getView().getModel("appModel").getProperty("/translatedContent");
            if (!sTranslation) {
                MessageToast.show("No translation to export.");
                return;
            }

            const blob = new Blob([sTranslation], { type: 'text/plain' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = "SmartDoc_Translation.txt";
            a.click();
            URL.revokeObjectURL(url);
            MessageToast.show("Translation exported successfully!");
        },

        async _loadHistory() {
            try {
                const response = await fetch(
                    "/smartdoc/Documents?$orderby=createdAt desc&$top=20&$format=json"
                );
                const data = await response.json();
                this.getView().getModel("historyModel").setProperty("/results", data.value || []);
            } catch (err) {
                console.error("Failed to load history:", err.message);
            }
        },

        onSelectHistory(oEvent) {
            const oItem  = oEvent.getSource();
            const oCtx   = oItem.getBindingContext("historyModel");
            const oDoc   = oCtx.getObject();
            const oModel = this.getView().getModel("appModel");

            oModel.setProperty("/currentDocumentId",  oDoc.ID);
            oModel.setProperty("/documentAnalyzed",   true);
            oModel.setProperty("/detectedLanguage",   oDoc.originalLanguage || 'Unknown');
            oModel.setProperty("/summary",            oDoc.summary || '');
            oModel.setProperty("/showSummary",        !!oDoc.summary);
            oModel.setProperty("/translatedContent",  oDoc.translatedContent || '');
            oModel.setProperty("/originalContent",    oDoc.originalContent || '');
            oModel.setProperty("/showTranslation",    !!oDoc.translatedContent);

            this._loadExtractedFields(oDoc.ID);
            MessageToast.show(`Loaded: ${oDoc.fileName}`);
        },

        onExit() {
            const el = document.getElementById("__smartDocFileInput");
            if (el) el.remove();
        }
    });
}); 