// ProfessionalSignUp.jsx
import React, { useState, useCallback, useRef, useMemo } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import Select from "react-select";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Country, State } from "country-state-city";
import {
  Button,
  Row,
  Col,
  Form,
  InputGroup,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Spinner,
} from "react-bootstrap";

// ---------------- validation schema ----------------
const schema = yup.object({
  accountType: yup.string().oneOf(["individual", "organisation"]).required("Account type is required"),
  role: yup.string().oneOf(["lawyer", "mediator", "counsellor", "therapist"]).required("Role is required"),
  name: yup.string().required("Name is required"),
  organizationName: yup.string().when("accountType", (accountType, schema) => {
    return accountType === "organisation"
      ? schema.required("Organization name is required for organisations")
      : schema.nullable();
  }),
  email: yup.string().email("Invalid email").required("Email is required"),
  phone: yup.string().required("Phone is required"),
  password: yup.string().min(6, "Minimum 6 characters").required("Password is required"),
  overview: yup.string().nullable(),
  languages: yup.array().of(yup.mixed()).min(1, "Select at least one language"),
  specialties: yup.string().nullable(),
  location: yup.object({
    country: yup.string().nullable(),
    state: yup.string().nullable(),
    city: yup.string().nullable(),
  }),
  education: yup.array().of(
    yup.object({
      degree: yup.string().required("Degree required"),
      institution: yup.string().required("Institution required"),
      year: yup.number().nullable(),
      fileUrl: yup.string().nullable(),
    })
  ),
  experience: yup.array().of(
    yup.object({
      firm: yup.string().required("Firm required"),
      role: yup.string().required("Role required"),
      years: yup.number().nullable(), // number of years
      description: yup.string().nullable(),
    })
  ),
  certificates: yup.array().of(
    yup.object({
      title: yup.string().required("Title required"),
      issuedBy: yup.string().required("Issuer required"),
      year: yup.number().nullable(),
      fileUrl: yup.string().nullable(),
    })
  ),
  documents: yup.array().of(
    yup.object({
      type: yup.string().required("Type required"),
      fileUrl: yup.string().nullable(),
    })
  ),
  additionalDocuments: yup.array().of(
    yup.object({
      title: yup.string().required("Title required"),
      description: yup.string().nullable(),
      fileUrl: yup.string().nullable(),
    })
  ),
  undertaking: yup.bool().oneOf([true], "You must accept the undertaking"),
  terms: yup.bool().oneOf([true], "You must agree to the Terms and Conditions"),
});

// ---------------- upload helper (simple XHR with progress) ----------------
function uploadFileWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);

    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append("file", file);

    const url = `${import.meta.env.VITE_API_URL || ""}/api/professionals/upload`;
    xhr.open("POST", url, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === "function") {
        const percent = Math.round((e.loaded / e.total) * 100);
        onProgress(percent);
      }
    };

    xhr.onload = () => {
      if (!xhr.responseText) {
        return reject(new Error(`Empty upload response (status ${xhr.status})`));
      }
      try {
        const resp = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && resp && resp.success && resp.fileUrl) {
          resolve(resp.fileUrl);
        } else {
          reject(new Error(resp?.message || `Upload failed with status ${xhr.status}`));
        }
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.send(fd);
  });
}

// ---------------- FileInput component ----------------
const FileInput = ({ id, onFileSelected, uploadedUrl, uploadingState }) => {
  const inputRef = useRef(null);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
      <input
        id={id}
        type="file"
        ref={inputRef}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && typeof onFileSelected === "function") onFileSelected(f);
        }}
        style={{ display: "none" }}
      />

      <label
        htmlFor={id}
        role="button"
        className="btn-upload"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderRadius: 10,
          cursor: "pointer",
          fontWeight: 700,
          border: "none",
          background: "linear-gradient(90deg,#CAAA93,#B07D5A)",
          color: "#fff",
          boxShadow: "0 8px 24px rgba(176,125,90,0.14)",
        }}
      >
        Upload
      </label>

      <div style={{ flex: 1, display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
        {uploadingState?.uploading ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Uploading</div>
            <div style={{ width: 100, height: 8, background: "rgba(0,0,0,0.06)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${uploadingState.progress || 0}%`, height: "100%", background: "linear-gradient(90deg,#CAAA93,#b07d5a)" }} />
            </div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{uploadingState.progress || 0}%</div>
          </div>
        ) : uploadedUrl ? (
          <a className="view-link small" href={uploadedUrl} target="_blank" rel="noreferrer" style={{ fontWeight: 700, color: "#2f6f6a" }}>
            View
          </a>
        ) : (
          <div style={{ color: "#98a2ad", fontSize: 13 }}>No file added</div>
        )}
      </div>
    </div>
  );
};

// ---------------- Main component ----------------
const ProfessionalSignUp = () => {
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: {
      accountType: "individual",
      role: "lawyer",
      name: "",
      organizationName: "",
      email: "",
      phone: "",
      password: "",
      overview: "",
      languages: [],
      specialties: "",
      location: { country: "", state: "", city: "" },
      education: [{ degree: "", institution: "", year: "", fileUrl: "" }],
      experience: [{ firm: "", role: "", years: "", description: "" }],
      certificates: [{ title: "", issuedBy: "", year: "", fileUrl: "" }],
      documents: [{ type: "", fileUrl: "" }],
      additionalDocuments: [{ title: "", description: "", fileUrl: "" }],
      undertaking: false,
      terms: false,
    },
  });

  const { fields: eduFields, append: appendEdu, remove: removeEdu } = useFieldArray({ control, name: "education" });
  const { fields: expFields, append: appendExp, remove: removeExp } = useFieldArray({ control, name: "experience" });
  const { fields: certFields, append: appendCert, remove: removeCert } = useFieldArray({ control, name: "certificates" });
  const { fields: docFields, append: appendDoc, remove: removeDoc } = useFieldArray({ control, name: "documents" });
  const { fields: addDocFields, append: appendAddDoc, remove: removeAddDoc } = useFieldArray({ control, name: "additionalDocuments" });

  const [uploadingMap, setUploadingMap] = useState({});
  const [showPassword, setShowPassword] = useState(false);

  const setUploadState = useCallback((key, patch) => {
    setUploadingMap((m) => ({ ...(m || {}), [key]: { ...(m?.[key] || {}), ...patch } }));
  }, []);

  const handleFileChangeAndSet = async (file, formFieldPath) => {
    if (!file || !formFieldPath) return;
    setUploadState(formFieldPath, { uploading: true, progress: 0 });
    try {
      const fileUrl = await uploadFileWithProgress(file, (percent) => {
        setUploadState(formFieldPath, { progress: percent, uploading: true });
      });
      if (fileUrl) {
        setValue(formFieldPath, fileUrl, { shouldDirty: true, shouldValidate: true });
      } else {
        throw new Error("Upload finished but server returned no file URL");
      }
    } catch (err) {
      console.error("Upload error:", err);
      alert(err?.message || "Upload failed");
    } finally {
      setUploadState(formFieldPath, { uploading: false, progress: 0 });
    }
  };

  const idFromPath = (path) => path.replace(/\./g, "-").replace(/\[/g, "-").replace(/\]/g, "");

  // languages options
  const languageOptions = useMemo(
    () => [
      { value: "English", label: "English" },
      { value: "Hindi", label: "Hindi" },
      { value: "Spanish", label: "Spanish" },
      { value: "German", label: "German" },
      { value: "French", label: "French" },
      { value: "Chinese", label: "Chinese" },
      { value: "Arabic", label: "Arabic" },
      { value: "Portuguese", label: "Portuguese" },
      { value: "Bengali", label: "Bengali" },
      { value: "Russian", label: "Russian" },
    ],
    []
  );

  // countries list (Country from country-state-city)
  const countries = useMemo(() => Country.getAllCountries().map((c) => ({ value: c.isoCode, label: c.name })), []);

  const accountType = watch("accountType");
  const selectedCountryIso = watch("location.country");

  // years options for experience: 0..30 (change range here if you want)
  const experienceYearOptions = useMemo(() => {
    const arr = [];
    for (let i = 0; i <= 30; i++) arr.push(i);
    return arr;
  }, []);

  const onSubmit = async (data) => {
    try {
      // transform languages to simple array of strings
      const payload = {
        ...data,
        languages: Array.isArray(data.languages) ? data.languages.map((l) => (typeof l === "string" ? l : l.value || l.label)) : [],
        specialties: data.specialties ? data.specialties.split(",").map((s) => s.trim()).filter(Boolean) : [],
      };

      // call register API
      const url = `${import.meta.env.VITE_API_URL || ""}/api/professionals/register`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const text = await res.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }

      if (res.ok && result?.success) {
        if (result.token) localStorage.setItem("token", result.token);
        alert("Registered successfully!");
        reset();
      } else {
        alert("Registration failed: " + (result?.message || JSON.stringify(result)));
      }
    } catch (err) {
      console.error("Registration error:", err);
      alert("Registration error: " + (err?.message || "Unknown"));
    }
  };

  // styles
  const pageStyle = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(180deg,#CAAA93,#D4B8A2)" };
  const containerStyle = { width: "100%", maxWidth: 1200, padding: "28px" };
  const cardStyle = { borderRadius: 14, overflow: "hidden" };

  const inputStyle = (val) => ({
    borderColor: val ? "#2f6f6a" : "#ced4da",
    backgroundColor: val ? "rgba(47,111,106,0.08)" : "#fff",
    boxShadow: val ? "0 0 0 3px rgba(47,111,106,0.06)" : "none",
    transition: "all 0.15s ease-in-out",
  });

  return (
    <div style={pageStyle}>
      <div style={containerStyle}>
        <Card style={cardStyle} className="shadow-lg auth-card">
          <CardHeader style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.04)", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <CardTitle as="h4" style={{ margin: 0 }}>
                  Professional Sign Up
                </CardTitle>
                <div style={{ color: "#6b7280", fontSize: 13 }}>Register as a lawyer, mediator, counsellor or therapist</div>
              </div>
            </div>
          </CardHeader>

          <CardBody style={{ padding: 24, background: "#fff" }}>
            <Form onSubmit={handleSubmit(onSubmit)}>
              {/* Account type + Role */}
              <Row className="mb-3" style={{ gap: 12 }}>
                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Account Type <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <div>
                      <Form.Check inline label="Individual" type="radio" {...register("accountType")} value="individual" id="acc-ind" />
                      <Form.Check inline label="Organisation" type="radio" {...register("accountType")} value="organisation" id="acc-org" />
                    </div>
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.accountType?.message}</div>
                  </Form.Group>
                </Col>

                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Role <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <Form.Select {...register("role")} style={inputStyle(watch("role"))}>
                      <option value="lawyer">Lawyer</option>
                      <option value="mediator">Mediator</option>
                      <option value="counsellor">Counsellor</option>
                      <option value="therapist">Therapist</option>
                    </Form.Select>
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.role?.message}</div>
                  </Form.Group>
                </Col>
              </Row>

              {/* Org name when organisation */}
              {accountType === "organisation" && (
                <Row className="mb-3">
                  <Col md style={{ minWidth: 320 }}>
                    <Form.Group>
                      <Form.Label>
                        Organization Name <span style={{ color: "#dc2626" }}>*</span>
                      </Form.Label>
                      <Form.Control placeholder="Organization name" {...register("organizationName")} style={inputStyle(watch("organizationName"))} />
                      <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.organizationName?.message}</div>
                    </Form.Group>
                  </Col>
                </Row>
              )}

              <Row className="mb-3" style={{ gap: 12 }}>
                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Name <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <Form.Control placeholder="Full name" {...register("name")} style={inputStyle(watch("name"))} />
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.name?.message}</div>
                  </Form.Group>
                </Col>

                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Email <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <Form.Control placeholder="Email" {...register("email")} style={inputStyle(watch("email"))} />
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.email?.message}</div>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Phone <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <Form.Control placeholder="+91-..." {...register("phone")} style={inputStyle(watch("phone"))} />
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.phone?.message}</div>
                  </Form.Group>
                </Col>

                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Password <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <InputGroup>
                      <Form.Control
                        type={showPassword ? "text" : "password"}
                        placeholder="Password"
                        {...register("password")}
                        isInvalid={!!errors.password}
                        style={inputStyle(watch("password"))}
                      />
                      <Button variant="outline-secondary" type="button" onClick={() => setShowPassword((s) => !s)}>
                        {showPassword ? "Hide" : "Show"}
                      </Button>
                    </InputGroup>
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.password?.message}</div>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>Overview</Form.Label>
                    <Form.Control placeholder="Short bio / overview" {...register("overview")} style={inputStyle(watch("overview"))} />
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.overview?.message}</div>
                  </Form.Group>
                </Col>

                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>
                      Languages <span style={{ color: "#dc2626" }}>*</span>
                    </Form.Label>
                    <Controller
                      control={control}
                      name="languages"
                      render={({ field }) => (
                        <Select
                          {...field}
                          isMulti
                          options={languageOptions}
                          onChange={(val) => field.onChange(val)}
                          value={field.value}
                          placeholder="Select known languages"
                        />
                      )}
                    />
                    <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.languages?.message}</div>
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>Specialties (comma separated)</Form.Label>
                    <Form.Control placeholder="Mergers, Family Law" {...register("specialties")} style={inputStyle(watch("specialties"))} />
                  </Form.Group>
                </Col>

                <Col md style={{ minWidth: 320 }}>
                  <Form.Group>
                    <Form.Label>Country</Form.Label>
                    <Controller
                      control={control}
                      name="location.country"
                      render={({ field }) => (
                        <Select
                          {...field}
                          options={countries}
                          onChange={(val) => {
                            field.onChange(val?.value || "");
                            // reset state when country changes
                            setValue("location.state", "");
                          }}
                          value={countries.find((c) => c.value === field.value) || null}
                          placeholder="Select country"
                        />
                      )}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row className="mb-3">
                <Col md style={{ minWidth: 220 }}>
                  <Form.Group>
                    <Form.Label>State</Form.Label>
                    <Controller
                      control={control}
                      name="location.state"
                      render={({ field }) => {
                        const states = selectedCountryIso ? State.getStatesOfCountry(selectedCountryIso).map((s) => ({ value: s.isoCode, label: s.name })) : [];
                        return (
                          <Select
                            {...field}
                            options={states}
                            onChange={(val) => field.onChange(val?.value || "")}
                            value={states.find((s) => s.value === field.value) || null}
                            placeholder={selectedCountryIso ? "Select state" : "Select country first"}
                            isDisabled={!selectedCountryIso}
                          />
                        );
                      }}
                    />
                  </Form.Group>
                </Col>
                <Col md style={{ minWidth: 220 }}>
                  <Form.Group>
                    <Form.Label>City</Form.Label>
                    <Form.Control {...register("location.city")} placeholder="City" style={inputStyle(watch("location.city"))} />
                  </Form.Group>
                </Col>
              </Row>

              {/* Education (repeatable) */}
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <h6 style={{ margin: 0 }}>
                    Education <span style={{ color: "#dc2626" }}>*</span>
                  </h6>

                  <Button variant="link" size="sm" onClick={() => appendEdu({ degree: "", institution: "", year: "", fileUrl: "" })}>
                    + Add
                  </Button>
                </div>

                {eduFields.map((f, idx) => {
                  const degPath = `education.${idx}.degree`;
                  const instPath = `education.${idx}.institution`;
                  const yearPath = `education.${idx}.year`;
                  const filePath = `education.${idx}.fileUrl`;
                  const uploaded = watch(filePath);
                  const uploadingState = uploadingMap[filePath] || { uploading: false, progress: 0 };
                  const domId = idFromPath(filePath);

                  return (
                    <div key={f.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <Row className="align-items-center">
                        <Col md style={{ minWidth: 260 }}>
                          <Form.Label>Degree <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <Form.Control placeholder="Degree (LL.B.)" {...register(degPath)} style={inputStyle(watch(degPath))} />
                          <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.education?.[idx]?.degree?.message}</div>
                        </Col>
                        <Col md style={{ minWidth: 260 }}>
                          <Form.Label>Institution <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <Form.Control placeholder="Institution" {...register(instPath)} style={inputStyle(watch(instPath))} />
                          <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.education?.[idx]?.institution?.message}</div>
                        </Col>
                        <Col md style={{ minWidth: 120 }}>
                          <Form.Label>Year <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <Controller
                            control={control}
                            name={yearPath}
                            render={({ field }) => (
                              <DatePicker
                                selected={field.value ? new Date(field.value, 0, 1) : null}
                                onChange={(date) => field.onChange(date ? date.getFullYear() : null)}
                                showYearPicker
                                dateFormat="yyyy"
                                placeholderText="Year"
                                customInput={<input className="form-control" />}
                              />
                            )}
                          />
                        </Col>
                        <Col md style={{ minWidth: 200 }}>
                          <Form.Label>Upload <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <div style={inputStyle(uploaded)}>
                            <FileInput id={domId} onFileSelected={(file) => handleFileChangeAndSet(file, filePath)} uploadedUrl={uploaded} uploadingState={uploadingState} />
                          </div>
                        </Col>
                        <Col md={12} style={{ marginTop: 8, textAlign: "right" }}>
                          <Button variant="danger" size="sm" onClick={() => removeEdu(idx)}>
                            Remove
                          </Button>
                        </Col>
                      </Row>
                    </div>
                  );
                })}
              </div>

              {/* Experience (repeatable) with numeric dropdown for years */}
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <h6 style={{ margin: 0 }}>Experience</h6>
                  <Button variant="link" size="sm" onClick={() => appendExp({ firm: "", role: "", years: "", description: "" })}>
                    + Add
                  </Button>
                </div>

                {expFields.map((f, idx) => {
                  const firmPath = `experience.${idx}.firm`;
                  const rolePath = `experience.${idx}.role`;
                  const yearsPath = `experience.${idx}.years`;
                  const descPath = `experience.${idx}.description`;
                  return (
                    <div key={f.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <Row className="align-items-center">
                        <Col md style={{ minWidth: 240 }}>
                          <Form.Label>Firm <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <Form.Control placeholder="Firm (Smith & Partners)" {...register(firmPath)} style={inputStyle(watch(firmPath))} />
                        </Col>
                        <Col md style={{ minWidth: 200 }}>
                          <Form.Label>Role <span style={{ color: "#dc2626" }}>*</span></Form.Label>
                          <Form.Control placeholder="Role (Senior Associate)" {...register(rolePath)} style={inputStyle(watch(rolePath))} />
                        </Col>

                        <Col md style={{ minWidth: 120 }}>
                          <Form.Label>No. of years</Form.Label>
                          <Form.Select {...register(yearsPath)} style={inputStyle(watch(yearsPath))}>
                            <option value="">Select years</option>
                            {experienceYearOptions.map((y) => (
                              <option key={y} value={y}>
                                {y}
                              </option>
                            ))}
                          </Form.Select>
                        </Col>

                        <Col md style={{ minWidth: 260 }}>
                          <Form.Label>Description</Form.Label>
                          <Form.Control placeholder="Short description" {...register(descPath)} style={inputStyle(watch(descPath))} />
                        </Col>
                        <Col md={12} style={{ marginTop: 8, textAlign: "right" }}>
                          <Button variant="danger" size="sm" onClick={() => removeExp(idx)}>
                            Remove
                          </Button>
                        </Col>
                      </Row>
                    </div>
                  );
                })}
              </div>

              {/* Certificates (repeatable) */}
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <h6 style={{ margin: 0 }}>Certificates</h6>
                  <Button variant="link" size="sm" onClick={() => appendCert({ title: "", issuedBy: "", year: "", fileUrl: "" })}>
                    + Add
                  </Button>
                </div>

                {certFields.map((f, idx) => {
                  const titlePath = `certificates.${idx}.title`;
                  const issuerPath = `certificates.${idx}.issuedBy`;
                  const yearPath = `certificates.${idx}.year`;
                  const filePath = `certificates.${idx}.fileUrl`;
                  const uploaded = watch(filePath);
                  const uploadingState = uploadingMap[filePath] || { uploading: false, progress: 0 };
                  const domId = idFromPath(filePath);

                  return (
                    <div key={f.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <Row className="align-items-center">
                        <Col md style={{ minWidth: 260 }}>
                          <Form.Control placeholder="Title" {...register(titlePath)} style={inputStyle(watch(titlePath))} />
                        </Col>
                        <Col md style={{ minWidth: 260 }}>
                          <Form.Control placeholder="Issued By" {...register(issuerPath)} style={inputStyle(watch(issuerPath))} />
                        </Col>
                        <Col md style={{ minWidth: 120 }}>
                          <Controller
                            control={control}
                            name={yearPath}
                            render={({ field }) => (
                              <DatePicker
                                selected={field.value ? new Date(field.value, 0, 1) : null}
                                onChange={(date) => field.onChange(date ? date.getFullYear() : null)}
                                showYearPicker
                                dateFormat="yyyy"
                                placeholderText="Year"
                                customInput={<input className="form-control" />}
                              />
                            )}
                          />
                        </Col>
                        <Col md style={{ minWidth: 200 }}>
                          <div style={inputStyle(uploaded)}>
                            <FileInput id={domId} onFileSelected={(file) => handleFileChangeAndSet(file, filePath)} uploadedUrl={uploaded} uploadingState={uploadingState} />
                          </div>
                        </Col>
                      </Row>
                    </div>
                  );
                })}
              </div>

              {/* Documents (repeatable) */}
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <h6 style={{ margin: 0 }}>Documents (ID proof etc.)</h6>
                  <Button variant="link" size="sm" onClick={() => appendDoc({ type: "", fileUrl: "" })}>
                    + Add
                  </Button>
                </div>

                {docFields.map((f, idx) => {
                  const fieldTypePath = `documents.${idx}.type`;
                  const fieldFilePath = `documents.${idx}.fileUrl`;
                  const uploaded = watch(fieldFilePath);
                  const uploadingState = uploadingMap[fieldFilePath] || { uploading: false, progress: 0 };
                  const domId = idFromPath(fieldFilePath);
                  return (
                    <div key={f.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <Row className="align-items-center">
                        <Col md style={{ minWidth: 260 }}>
                          <Form.Control placeholder="Type (e.g. id_proof)" {...register(fieldTypePath)} style={inputStyle(watch(fieldTypePath))} />
                        </Col>
                        <Col md style={{ minWidth: 420 }}>
                          <div style={inputStyle(uploaded)}>
                            <FileInput id={domId} onFileSelected={(file) => handleFileChangeAndSet(file, fieldFilePath)} uploadedUrl={uploaded} uploadingState={uploadingState} />
                          </div>
                        </Col>
                        <Col md style={{ minWidth: 120, textAlign: "right" }}>
                          <Button variant="danger" size="sm" onClick={() => removeDoc(idx)}>
                            Remove
                          </Button>
                        </Col>
                      </Row>
                    </div>
                  );
                })}
              </div>

              {/* Additional Documents */}
              <div style={{ background: "#fff", borderRadius: 10, padding: 14, marginBottom: 16, border: "1px solid rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <h6 style={{ margin: 0 }}>Additional Documents</h6>
                  <Button variant="link" size="sm" onClick={() => appendAddDoc({ title: "", description: "", fileUrl: "" })}>
                    + Add
                  </Button>
                </div>

                {addDocFields.map((f, idx) => {
                  const titlePath = `additionalDocuments.${idx}.title`;
                  const descPath = `additionalDocuments.${idx}.description`;
                  const filePath = `additionalDocuments.${idx}.fileUrl`;
                  const uploaded = watch(filePath);
                  const uploadingState = uploadingMap[filePath] || { uploading: false, progress: 0 };
                  const domId = idFromPath(filePath);
                  return (
                    <div key={f.id} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid rgba(0,0,0,0.04)" }}>
                      <Row className="align-items-center">
                        <Col md style={{ minWidth: 220 }}>
                          <Form.Control placeholder="Title" {...register(titlePath)} style={inputStyle(watch(titlePath))} />
                        </Col>
                        <Col md style={{ minWidth: 360 }}>
                          <Form.Control placeholder="Description" {...register(descPath)} style={inputStyle(watch(descPath))} />
                        </Col>
                        <Col md style={{ minWidth: 260 }}>
                          <div style={inputStyle(uploaded)}>
                            <FileInput id={domId} onFileSelected={(file) => handleFileChangeAndSet(file, filePath)} uploadedUrl={uploaded} uploadingState={uploadingState} />
                          </div>
                        </Col>
                        <Col md style={{ minWidth: 80, textAlign: "right" }}>
                          <Button variant="danger" size="sm" onClick={() => removeAddDoc(idx)}>
                            Remove
                          </Button>
                        </Col>
                      </Row>
                    </div>
                  );
                })}
              </div>

              {/* Undertaking & Terms */}
              <div style={{ marginBottom: 12 }}>
                <Form.Group>
                  <Form.Check
                    type="checkbox"
                    label={
                      <span>
                        Undertaking — I confirm that all details provided are my own and I am responsible for their accuracy. <span style={{ color: "#dc2626" }}>*</span>
                      </span>
                    }
                    {...register("undertaking")}
                  />
                  <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.undertaking?.message}</div>
                </Form.Group>
                <Form.Group style={{ marginTop: 8 }}>
                  <Form.Check
                    type="checkbox"
                    label={
                      <span>
                        I agree - Terms and Conditions <span style={{ color: "#dc2626" }}>*</span>
                      </span>
                    }
                    {...register("terms")}
                  />
                  <div style={{ color: "#dc2626", fontSize: 12 }}>{errors.terms?.message}</div>
                </Form.Group>
              </div>

              <div style={{ display: "flex", justifyContent: "center", marginTop: 8 }}>
                <Button variant="primary" type="submit" disabled={isSubmitting} style={{ padding: "10px 22px", borderRadius: 10 }}>
                  {isSubmitting ? (
                    <>
                      <Spinner animation="border" size="sm" /> Registering...
                    </>
                  ) : (
                    "Sign Up as Professional"
                  )}
                </Button>
              </div>

              <p style={{ textAlign: "center", color: "#6b7280", marginTop: 18 }}>
                Have an account? <a href="/auth/professional-login" style={{ fontWeight: 700 }}>Sign In</a>
              </p>
            </Form>
          </CardBody>
        </Card>
      </div>
    </div>
  );
};

export default ProfessionalSignUp;
