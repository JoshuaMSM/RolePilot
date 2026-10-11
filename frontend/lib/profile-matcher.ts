import type { NormalizedPosting } from "@/lib/discovery";
import { matchesTargetRole } from "@/lib/discovery";

export function evaluatePosting(job: NormalizedPosting, filters: Record<string, unknown>) {
  const roles = Array.isArray(filters.target_roles) ? filters.target_roles.filter((value): value is string => typeof value === "string") : [];
  const skills = Array.isArray(filters.skills) ? filters.skills.filter((value): value is string => typeof value === "string") : [];
  const countries = Array.isArray(filters.countries) ? filters.countries.filter((value): value is string => typeof value === "string") : [];
  const searchable = `${job.title} ${job.description ?? ""}`.toLocaleLowerCase();
  const roleMatch = matchesTargetRole(job.title, roles);
  const matchedSkills = skills.filter((skill) => searchable.includes(skill.toLocaleLowerCase()));
  const skillScore = skills.length ? Math.round((matchedSkills.length / skills.length) * 30) : 30;
  const location = (job.location ?? "").toLocaleLowerCase();
  const matchingCountry = countries.find((country) => location.includes(country.toLocaleLowerCase()));
  const locationUnknown = !job.location || !countries.length;
  const locationScore = locationUnknown ? 8 : matchingCountry ? 15 : 0;
  const candidateYears = typeof filters.minimum_experience === "number" ? filters.minimum_experience : null;
  const requirement = searchable.match(/(?:minimum|min\.?|at least)?\s*(\d+(?:\.\d+)?)\s*\+?\s*(?:years?|yrs?)(?:\s+of\s+(?:relevant\s+)?experience)?/i);
  const requiredYears = requirement ? Number(requirement[1]) : null;
  const experienceUnknown = candidateYears === null || requiredYears === null;
  const experienceScore = experienceUnknown ? 6 : candidateYears >= requiredYears ? 10 : 0;
  const sponsorshipRequired = filters.sponsorship_required === true;
  const sponsorYes = /visa sponsorship (?:is )?(?:available|provided|offered)|sponsorship available/i.test(searchable);
  const sponsorNo = /no visa sponsorship|unable to sponsor|cannot sponsor|will not sponsor/i.test(searchable);
  const sponsorshipUnknown = sponsorshipRequired && !sponsorYes && !sponsorNo;
  const sponsorshipScore = !sponsorshipRequired ? 5 : sponsorYes ? 5 : 0;

  const score = Math.max(0, Math.min(100, Math.round((roleMatch ? 40 : 0) + skillScore + locationScore + experienceScore + sponsorshipScore)));
  const missing = [
    ...(!roleMatch ? ["Target role not matched"] : []),
    ...skills.filter((skill) => !matchedSkills.includes(skill)).slice(0, 8).map((skill) => `Skill not found: ${skill}`),
    ...(locationUnknown ? ["Location needs review"] : !matchingCountry ? ["Outside target countries"] : []),
    ...(requiredYears !== null && candidateYears !== null && requiredYears > candidateYears ? [`Posting asks for ${requiredYears}+ years`] : []),
    ...(sponsorshipUnknown ? ["Visa sponsorship needs confirmation"] : sponsorNo && sponsorshipRequired ? ["Posting says sponsorship is unavailable"] : []),
  ];
  const hardReject = !roleMatch || (!locationUnknown && countries.length > 0 && !matchingCountry) || (requiredYears !== null && candidateYears !== null && requiredYears > candidateYears) || (sponsorshipRequired && sponsorNo);
  const decision = hardReject || score < 40 ? "REJECTED" : sponsorshipUnknown || locationUnknown || score < 70 ? "PENDING_REVIEW" : "QUALIFIED";
  const explanation = [
    roleMatch ? "Title aligns with a target role" : "Title does not align with a target role",
    skills.length ? `${matchedSkills.length}/${skills.length} profile skills found in the posting` : "No skill filters configured",
    matchingCountry ? `Location matches ${matchingCountry}` : locationUnknown ? "Location is not explicit" : "Location is outside target countries",
    requiredYears !== null ? `${requiredYears}+ years requested${candidateYears !== null && requiredYears <= candidateYears ? ", within candidate experience" : ""}` : "No explicit experience requirement found",
    sponsorshipRequired ? sponsorYes ? "Sponsorship is mentioned" : sponsorNo ? "Sponsorship is stated unavailable" : "Sponsorship is not stated" : "Sponsorship not required",
  ].join(". ") + ".";
  return { score, decision, explanation, missingRequirements: missing, modelProvider: "rolepilot-rules-v1" };
}
