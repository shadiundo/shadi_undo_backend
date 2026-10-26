import React from "react";
import IconifyIcon from "@/components/wrappers/IconifyIcon";
import { Button, Card, CardBody, CardHeader, CardTitle } from "react-bootstrap";

const PersonalInfo = ({ professional }) => {
  if (!professional)
    return (
      <Card>
        <CardHeader>
          <CardTitle as={"h5"}>Personal Info</CardTitle>
        </CardHeader>
        <CardBody>Loading...</CardBody>
      </Card>
    );

  const {
    name,
    email,
    phone,
    role,
    location = {},
    education = [],
    experience = [],
    languages = [],
  } = professional;

  const totalYears = experience?.reduce((acc, e) => acc + (e.years || 0), 0);

  const formattedLocation = [location.city, location.state, location.country]
    .filter(Boolean)
    .join(", ");

  return (
    <Card>
      <CardHeader>
        <CardTitle as={"h5"}>Personal Info</CardTitle>
      </CardHeader>
      <CardBody>
        <ul className="list-group">
          <li className="list-group-item border-0 border-bottom px-0 pt-0">
            <div className="d-flex flex-wrap align-items-center">
              <h5 className="me-2 fw-medium mb-0">Name :</h5>
              <span className="fs-14 text-muted">{name || "-"}</span>
            </div>
          </li>

          <li className="list-group-item border-0 border-bottom px-0">
            <div className="d-flex flex-wrap align-items-center">
              <h5 className="me-2 fw-medium mb-0">Email :</h5>
              <span className="fs-14 text-muted">{email || "-"}</span>
            </div>
          </li>

          <li className="list-group-item border-0 border-bottom px-0">
            <div className="d-flex flex-wrap align-items-center">
              <h5 className="me-2 mb-0 fw-medium">Phone :</h5>
              <span className="fs-14 text-muted">{phone || "-"}</span>
            </div>
          </li>

          <li className="list-group-item border-0 border-bottom px-0">
            <div className="d-flex flex-wrap align-items-start">
              <h5 className="me-2 mb-0 fw-medium">Location :</h5>
              <span className="fs-14 text-muted d-flex align-items-center gap-1">
                <IconifyIcon icon="mdi:map-marker-outline" className="text-warning fs-5" />
                {formattedLocation || "-"}
              </span>
            </div>
          </li>

          <li className="list-group-item border-0 border-bottom px-0">
            <div className="d-flex flex-wrap align-items-center">
              <h5 className="me-2 mb-0 fw-medium">Designation :</h5>
              <span className="fs-14 text-muted">
                {role ? role.charAt(0).toUpperCase() + role.slice(1) : "-"}
              </span>
            </div>
          </li>

          <li className="list-group-item border-0 border-bottom px-0">
            <div>
              <div className="d-flex flex-wrap align-items-center mb-2">
                <h5 className="me-2 mb-0 fw-medium">Education :</h5>
                <span className="fs-14 text-muted">
                  {education.length > 0 ? (
                    education.map((edu, index) => (
                      <div key={index} className="mb-1">
                        🎓 {edu.degree || "N/A"} — {edu.institution || "Unknown"}{" "}
                        {edu.year && <small>({edu.year})</small>}
                      </div>
                    ))
                  ) : (
                    <span className="text-muted">No education details</span>
                  )}
                </span>
              </div>
            </div>
          </li>

          {/* Experience summary */}
          <li className="list-group-item border-0 border-bottom px-0">
            <div className="d-flex flex-wrap align-items-center">
              <h5 className="me-2 mb-0 fw-medium">Experience :</h5>
              <span className="fs-14 text-muted">{totalYears ? `${totalYears} Years` : "-"}</span>
            </div>
          </li>

          {/* Detailed experience entries */}
          {experience && experience.length > 0 && (
            <li className="list-group-item border-0 px-0">
              <div className="mt-3">
                <CardTitle as="h6" className="mb-2">
                  Work Experience
                </CardTitle>

                <div className="d-flex flex-column gap-3">
                  {experience.map((exp, idx) => (
                    <div key={idx} className="p-3 border rounded-2 bg-white">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <h6 className="mb-1">{exp.firm || "Unknown Firm"}</h6>
                          <p className="mb-1 text-muted">
                            <strong>Role:</strong> {exp.role || "N/A"}{" "}
                            {" — "}
                            <strong>Years:</strong> {exp.years ?? "N/A"}
                          </p>
                        </div>
                        <div className="text-end">
                          {/* optional: you can show years or a small badge */}
                          <span className="badge bg-light text-secondary">{exp.years ?? "-" } yrs</span>
                        </div>
                      </div>

                      {exp.description && (
                        <p className="mb-0 text-muted mt-2">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </li>
          )}

          <li className="list-group-item border-0 px-0 pb-0">
            <div className="mt-3 pt-2 pb-2 px-3 bg-light rounded-3 border w-100">
              <div className="fw-semibold text-dark mb-2">Languages</div>
              <div className="d-flex flex-wrap gap-3">
                {languages.length > 0 ? (
                  languages.map((lang, i) => (
                    <span
                      key={i}
                      className="px-3 py-2 bg-white border rounded-pill shadow-sm text-dark fw-medium"
                    >
                      {lang}
                    </span>
                  ))
                ) : (
                  <span className="text-muted">No languages listed</span>
                )}
              </div>
            </div>
          </li>
        </ul>
      </CardBody>
    </Card>
  );
};

export default PersonalInfo;
