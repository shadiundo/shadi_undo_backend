// src/components/Stats.jsx
import React from "react";
import IconifyIcon from "@/components/wrappers/IconifyIcon";
import { stateData } from "../data";
import { Card, CardBody, Col, Row } from "react-bootstrap";
import { Link, useLocation } from "react-router-dom";

const StatCard = ({ stat }) => {
  const { amount, change, changeColor, badgeIcon, icon, iconColor, title, link } = stat;

  return (
    <Link to={link || "#"} style={{ textDecoration: "none", color: "inherit" }}>
      <Card className="h-100" role="button">
        <CardBody className="overflow-hidden position-relative">
          <IconifyIcon icon={icon} className={`fs-36 text-${iconColor}`} />
          <h3 className="mb-0 fw-bold mt-3 mb-1">{amount}</h3>
          <p className="text-muted">{title}</p>
          <span className={`badge fs-12 badge-soft-${changeColor}`}>{change}%</span>
          <IconifyIcon icon={badgeIcon} className="widget-icon" />
        </CardBody>
      </Card>
    </Link>
  );
};

const Stats = () => {
  const location = useLocation();

  return (
    <Row>
      {stateData.map((stat, idx) => (
        <Col lg={4} md={6} className="col-xl" key={idx}>
          <StatCard stat={stat} />
        </Col>
      ))}
    </Row>
  );
};

export default Stats;
