// ProfessionalLoginPage.jsx
import React, { useState } from "react";
import { Card, CardBody, Col, Row, Button, Form, InputGroup } from "react-bootstrap";
import { useForm } from "react-hook-form";
import { yupResolver } from "@hookform/resolvers/yup";
import * as yup from "yup";
import signInImg from "@/assets/images/sign-in.png"; // change if path differs
import LogoBox from "@/components/LogoBox"; // optional
import ThirdPartyAuth from "@/components/ThirdPartyAuth"; // optional

// Validation schema
const schema = yup.object({
  email: yup.string().email("Invalid email").required("Required"),
  password: yup.string().required("Required"),
});

export default function ProfessionalLoginPage() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: yupResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const [showPassword, setShowPassword] = useState(false);
const onSubmit = async (data) => {
  try {
    console.log("Submitting login, payload:", data);
    console.log("VITE_API_URL:", import.meta.env.VITE_API_URL);

    const url = `${import.meta.env.VITE_API_URL}/api/professionals/login`;
    console.log("Login URL:", url);

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });

    console.log("Fetch returned, status:", response.status, "ok:", response.ok);

    let result; // ✅ declare the variable before using it
    const resultText = await response.text();
    console.log("Raw response text:", resultText);

    try {
      result = JSON.parse(resultText);
    } catch (e) {
      console.warn("Response was not valid JSON:", e);
      result = { message: resultText };
    }

    if (!response.ok) {
      throw new Error(`Login failed: ${response.status} ${JSON.stringify(result)}`);
    }

    console.log("Login result:", result);

    if (result?.success && result?.token) {
      localStorage.setItem("token", result.token);
      window.location.href = "/pages/pricing";
    } else {
      alert("Login failed: " + (result?.message || "Unknown error"));
    }
  } catch (err) {
    console.error("Fetch login error:", err);
    alert("Login failed — check console for details.");
  }
};


  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center" style={{ background: "linear-gradient( #CAAA93, #d4b8a2)" }}>
      <div className="container py-5">
        <Card className="auth-card shadow-lg overflow-hidden">
          <CardBody className="p-0">
            <Row className="g-0 align-items-center">
              {/* Left illustration - hidden on small screens */}
              <Col lg={6} className="d-none d-lg-flex border-end bg-white align-items-center justify-content-center" style={{ minHeight: 520 }}>
                <div className="text-center p-5" style={{ maxWidth: 600 }}>
                  <img src={signInImg} alt="illustration" className="img-fluid mb-6  bg-white" />
                  <h4 className="fw-bold text-dark mt-4">Welcome back</h4>
                  <p className="text-muted">
                    Sign in to access your professional dashboard and manage clients, cases, and schedules.
                  </p>
                </div>
              </Col>

              {/* Right form */}
              <Col lg={6}>
                <div className="p-4 p-md-5">
                  <div className="text-center mb-4">
                    {/* optional logo */}
                    {typeof LogoBox !== "undefined" && <LogoBox containerClassName="mx-auto mb-3 text-center auth-logo" />}
                    <h2 className="fw-bold mb-1">Sign In Professions</h2>
                    <p className="text-muted mb-0">Enter your email address and password to access Professional panel.</p>
                  </div>

                  <Row className="justify-content-center">
                    <Col xs={12} md={10} lg={9}>
                      <Form onSubmit={handleSubmit(onSubmit)}>

                        {/* Email */}
                        <Form.Group className="mb-3" controlId="email">
                          <Form.Label className="small fw-medium">Email</Form.Label>
                          <Form.Control
                            type="email"
                            placeholder="you@company.com"
                            {...register("email")}
                            isInvalid={!!errors.email}
                          />
                          <Form.Control.Feedback type="invalid">{errors.email?.message}</Form.Control.Feedback>
                        </Form.Group>

                        {/* Password with show/hide */}
                        <Form.Group className="mb-3" controlId="password" style={{color:"black"}}>
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <Form.Label className="small fw-medium mb-0">Password</Form.Label>
                            <a href="#" style={{color:"black"}} >Reset password</a>
                          </div>

                          <InputGroup>
                            <Form.Control
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              {...register("password")}
                              isInvalid={!!errors.password}
                            />
                            <Button
                              variant="outline-secondary"
                              type="button"
                              onClick={() => setShowPassword((s) => !s)}
                              aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 12a5 5 0 110-10 5 5 0 010 10z" /></svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 2l20 20M4 4c3-3 8-4 10-4s7 1 10 4M9 9a3 3 0 104.24 4.24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                              )}
                            </Button>
                          </InputGroup>

                          <Form.Control.Feedback type="invalid" style={{ display: errors.password ? "block" : "none" }}>
                            {errors.password?.message}
                          </Form.Control.Feedback>
                        </Form.Group>

                        {/* Remember + submit */}
                        <div className="d-flex align-items-center mb-3">
                          <Form.Check id="remember" label="Remember me" className="me-auto" />
                        </div>

                        <div className="d-grid mb-3  ">
                          <Button type="submit" variant="primary" size="lg" disabled={isSubmitting}>
                            {isSubmitting ? "Signing in..." : "Sign In"}
                          </Button>
                        </div>

                     
                        {/* Social buttons (optional component fallback) */}
                        {/* {typeof ThirdPartyAuth !== "undefined" ? (
                          <ThirdPartyAuth />
                        ) : (
                          <div className="d-flex gap-2 flex-wrap">
                            <Button variant="light" className="w-100 w-sm-auto d-flex align-items-center gap-2 border">
                              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/google/google-original.svg" alt="Google" width={18} height={18} />
                              <span>Google</span>
                            </Button>
                            <Button variant="light" className="w-100 w-sm-auto d-flex align-items-center gap-2 border">
                              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/facebook/facebook-original.svg" alt="Facebook" width={18} height={18} />
                              <span>Facebook</span>
                            </Button>
                            <Button variant="light" className="w-100 w-sm-auto d-flex align-items-center gap-2 border">
                              <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/github/github-original.svg" alt="GitHub" width={18} height={18} />
                              <span>GitHub</span>
                            </Button>
                          </div>
                        )} */}

                        <p className="text-center text-muted mt-4 mb-0">
                          Don't have an account? <a href="/auth/professional-signup" className="fw-semibold">Sign Up</a>
                        </p>
                       
                      </Form>
                    </Col>
                  </Row>
                </div>
              </Col>
            </Row>
          </CardBody>
        </Card>

       
      </div>
    </div>
  );
}
