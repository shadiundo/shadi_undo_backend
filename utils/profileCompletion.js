export const calculateProfileCompletion = (prof) => {
  let score = 0;

  // Basic info
  if (prof.name && prof.email && prof.phone) score += 20;

  // Lawyer verification
  if (
    prof.role === "lawyer" &&
    prof.enrollmentNumber &&
    Array.isArray(prof.documents) &&
    prof.documents.length > 0
  ) {
    score += 30;
  }

  // Education
  if (Array.isArray(prof.education) && prof.education.length > 0) {
    score += 10;
  }

  // Experience
  if (Array.isArray(prof.experience) && prof.experience.length > 0) {
    score += 10;
  }

  // Availability
  if (Array.isArray(prof.availability) && prof.availability.length > 0) {
    score += 10;
  }

  // Pricing
  if (
    (Array.isArray(prof.rateOptions) && prof.rateOptions.length > 0) ||
    prof.defaultRate > 0
  ) {
    score += 10;
  }

  // Profile photo + overview
  if (prof.profilePhoto && prof.overview) {
    score += 10;
  }

  return Math.min(score, 100);
};
