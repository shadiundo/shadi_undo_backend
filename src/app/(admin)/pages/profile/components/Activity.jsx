// Activity.jsx
import React, { useMemo, useState, useEffect } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Row,
  Col,
  OverlayTrigger,
  Tooltip,
  Button,
  Modal,
  Spinner,
  Alert,
} from "react-bootstrap";
import IconifyIcon from "@/components/wrappers/IconifyIcon";

// API base (Vite env or fallback)
const API_BASE = (import.meta.env.VITE_API_BASE || "http://localhost:5000").replace(/\/$/, "");

/** Build absolute URL and sanitize */
function ensureAbsoluteUrl(maybeUrl) {
  if (!maybeUrl) return null;
  let s = String(maybeUrl).trim();
  s = s.replace(/^['"]+|['"]+$/g, ""); // strip wrapping quotes

  // If already absolute
  try {
    const u = new URL(s);
    return u.toString();
  } catch (e) {}

  // If relative uploads path, map to streaming endpoint
  if (s.startsWith("/uploads/")) {
    const filename = s.split("/").pop();
    if (!filename) return null;
    return `${API_BASE}/api/professionals/files/${encodeURIComponent(filename)}`;
  }

  // Generic relative path
  const pathStr = s.startsWith("/") ? s : `/${s}`;
  return `${API_BASE}${pathStr}`;
}

/** Normalize file item (string or object) */
function normalizeFileItem(raw, source = "file") {
  if (!raw) return null;
  if (typeof raw === "string") {
    const name = raw.split("/").pop() || "file";
    return { fileUrl: raw, name, source };
  }
  const url = raw.fileUrl || raw.url || raw.path || raw;
  if (!url) return null;
  const name = raw.name || raw.filename || (typeof url === "string" ? url.split("/").pop() : "file");
  return { fileUrl: url, name, source };
}

/** Modal that checks URL then shows iframe or helpful message */
function FileViewerModalSafe({ show, onClose, file }) {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(null);
  const [status, setStatus] = useState(null);
  const [checkedUrl, setCheckedUrl] = useState(null);

  useEffect(() => {
    let alive = true;
    async function checkUrl() {
      setOk(null);
      setStatus(null);
      setCheckedUrl(null);
      if (!show) return;
      if (!file || !file.fileUrl) {
        setOk(false);
        setStatus("No file URL provided");
        return;
      }

      setLoading(true);
      const url = ensureAbsoluteUrl(file.fileUrl);
      setCheckedUrl(url);
      console.log("[FileViewerModalSafe] checking URL:", url);

      try {
        // Try HEAD first
        let resp = null;
        try {
          resp = await fetch(url, { method: "HEAD", mode: "cors" });
        } catch (e) {
          resp = null;
        }

        if (resp && resp.ok) {
          if (!alive) return;
          setOk(true);
          setStatus(resp.status);
          return;
        }

        const getResp = await fetch(url, { method: "GET", mode: "cors" });
        if (!alive) return;
        if (getResp.ok) {
          setOk(true);
          setStatus(getResp.status);
        } else {
          setOk(false);
          setStatus(getResp.status);
        }
      } catch (err) {
        setOk(false);
        setStatus(err.message || "Network/CORS error");
      } finally {
        if (alive) setLoading(false);
      }
    }

    checkUrl();
    return () => { alive = false; };
  }, [show, file]);

  return (
    <Modal show={show} onHide={onClose} size="lg" centered dialogClassName="modal-90w">
      <Modal.Header closeButton>
        <Modal.Title>{file?.name || "View Document"}</Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ minHeight: 420 }}>
        {loading && <div className="text-center py-5"><Spinner animation="border" /> Checking file...</div>}

        {!loading && ok === true && checkedUrl && (
          <iframe
            title={file?.name || "document"}
            src={checkedUrl}
            style={{ width: "100%", height: "70vh", border: "none" }}
          />
        )}

        {!loading && ok === false && (
          <>
            <Alert variant="danger">
              <strong>Unable to load file.</strong>
              <div className="mt-2">Status / error: <code>{String(status)}</code></div>
              <div className="mt-2">Tried URL: <code style={{ wordBreak: "break-all" }}>{checkedUrl || file?.fileUrl}</code></div>
            </Alert>

            <div className="d-flex gap-2 mb-3">
              <Button variant="primary" onClick={() => window.open(ensureAbsoluteUrl(file?.fileUrl || ""), "_blank", "noopener,noreferrer")}>
                Open in new tab
              </Button>
              <Button variant="secondary" onClick={() => { window.location.href = ensureAbsoluteUrl(file?.fileUrl || ""); }}>
                Go to URL
              </Button>
            </div>

            <div className="small text-muted">
              Troubleshooting:
              <ul>
                <li>Open the URL in a new tab to inspect server response (404 page, login redirect, JSON error).</li>
                <li>If URL requires authentication, you may need to fetch the file as a blob.</li>
              </ul>
            </div>
          </>
        )}

        {!loading && ok === null && <div className="text-center text-muted">Preparing to check file...</div>}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {ok === true && (
          <a
            href={ensureAbsoluteUrl(file?.fileUrl)}
            target="_blank"
            rel="noopener noreferrer"
            download={file?.name || ""}
            className="btn btn-primary"
            style={{ textDecoration: "none" }}
          >
            Download
          </a>
        )}
      </Modal.Footer>
    </Modal>
  );
}

/** ActivityItem (renders file controls) */
const ActivityItem = ({ title, time, content, files = [], onPreview }) => (
  <div className="position-relative ps-5 mb-4">
    <div>
      <span className="position-absolute start-0 ms-3 translate-middle-x d-inline-flex align-items-center justify-content-center rounded-circle bg-primary text-light fs-20 avatar-sm">
        <IconifyIcon icon="iconamoon:file-light" />
      </span>

      <div className="ms-2">
        <h5 className="mb-1 text-dark fw-semibold fs-15 lh-base">{title}</h5>
        {content && <p className="mb-2">{content}</p>}

        {files.length > 0 && (
          <div className="bg-light bg-opacity-50 rounded-2 p-2">
            <Row>
              {files.map((f, idx) => (
                <Col key={idx} xs={12} className="mb-2">
                  <div className="d-flex align-items-center gap-2">
                    <IconifyIcon icon="iconamoon:file-light" />
                    <div>
                      <div className="text-dark fw-medium">{f.name}</div>
                      <small className="text-muted">{f.source}</small>
                    </div>

                    <div className="ms-auto d-flex gap-2 align-items-center">
                      <OverlayTrigger placement="bottom" overlay={<Tooltip>Preview</Tooltip>}>
                        <Button variant="link" className="p-0" onClick={() => onPreview(f)}>
                          <IconifyIcon icon="iconamoon:eye-light" className="text-primary" />
                        </Button>
                      </OverlayTrigger>

                      <OverlayTrigger placement="bottom" overlay={<Tooltip>Open</Tooltip>}>
                        <a
                          href={ensureAbsoluteUrl(f.fileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-link p-0"
                        >
                          <IconifyIcon icon="iconamoon:external-link-line" className="text-primary" />
                        </a>
                      </OverlayTrigger>

                      <OverlayTrigger placement="bottom" overlay={<Tooltip>Download</Tooltip>}>
                        <a
                          href={ensureAbsoluteUrl(f.fileUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                          download={f.name}
                          className="btn btn-link p-0"
                        >
                          <IconifyIcon icon="iconamoon:cloud-download-duotone" className="text-primary" />
                        </a>
                      </OverlayTrigger>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>
          </div>
        )}

        <h6 className="mt-2 text-muted">{time ? new Date(time).toLocaleString() : ""}</h6>
      </div>
    </div>
  </div>
);

/** Main Activity component */
const Activity = ({ professional }) => {
  const [previewFile, setPreviewFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const activities = useMemo(() => {
    if (!professional) return [];
    const out = [];

    (professional.documents || []).forEach((d) => {
      const item = normalizeFileItem(d, "documents");
      out.push({
        title: d.type ? `Document — ${d.type}` : "Document uploaded",
        time: d.uploadedAt || professional.createdAt || d.createdAt,
        content: d.note || "",
        files: item ? [item] : [],
      });
    });

    (professional.additionalDocuments || []).forEach((d) => {
      const item = normalizeFileItem(d.fileUrl || d, "additionalDocuments");
      out.push({
        title: d.title || "Additional Document",
        time: d.assignedAt || d.createdAt || professional.createdAt,
        content: d.description || "",
        files: item ? [item] : [],
      });
    });

    (professional.education || []).forEach((e) => {
      const files = [];
      if (e.fileUrl) files.push(normalizeFileItem({ fileUrl: e.fileUrl, name: e.fileUrl.split("/").pop() }, "education"));
      out.push({
        title: e.degree ? `${e.degree} — ${e.institution || ""}` : "Education",
        time: e.year || professional.createdAt,
        content: e.institution || "",
        files,
      });
    });

    (professional.certificates || []).forEach((c) => {
      const files = [];
      if (c.fileUrl) files.push(normalizeFileItem({ fileUrl: c.fileUrl, name: c.fileUrl.split("/").pop() }, "certificates"));
      out.push({
        title: c.title || "Certificate",
        time: c.issuedAt || c.year || professional.createdAt,
        content: c.issuedBy ? `${c.issuedBy}` : "",
        files,
      });
    });

    (professional.experience || []).forEach((ex) => {
      const files = [];
      if (ex.fileUrl) files.push(normalizeFileItem({ fileUrl: ex.fileUrl, name: ex.fileUrl.split("/").pop() }, "experience"));
      out.push({
        title: ex.firm ? `${ex.role || "Role"} @ ${ex.firm}` : "Experience",
        time: ex.years || professional.createdAt,
        content: ex.description || "",
        files,
      });
    });

    (professional.attachments || []).forEach((a) => {
      const item = normalizeFileItem(a, "attachments");
      out.push({
        title: a.title || "Attachment",
        time: a.uploadedAt || professional.createdAt,
        content: a.note || "",
        files: item ? [item] : [],
      });
    });

    return out;
  }, [professional]);

  const allFiles = useMemo(() => {
    const f = [];
    activities.forEach((a) => (a.files || []).forEach((file) => f.push({ ...file, title: a.title, time: a.time })));
    return f;
  }, [activities]);

  function handlePreview(file) {
    if (!file) return;
    setPreviewFile(file);
    setShowPreview(true);
  }

  if (!professional) return <Card><CardBody>Loading...</CardBody></Card>;

  return (
    <>
      <Card id="documents-section">
        <CardHeader className="d-flex align-items-center">
          <CardTitle as="h5">Documents ({allFiles.length})</CardTitle>
        </CardHeader>

        <CardBody>
          {allFiles.length === 0 ? (
            <p className="text-muted">No documents uploaded.</p>
          ) : (
            activities.map((a, i) => <ActivityItem key={i} {...a} onPreview={handlePreview} />)
          )}
        </CardBody>
      </Card>

      <FileViewerModalSafe
        show={showPreview}
        onClose={() => { setShowPreview(false); setPreviewFile(null); }}
        file={previewFile}
      />
    </>
  );
};

export default Activity;
