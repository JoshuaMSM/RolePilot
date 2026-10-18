"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";

export type CatalogCompanyOption = { name: string; normalizedName: string };

function normalizeCompanyName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = above;
    }
  }
  return row[right.length];
}

export function CompanyTargetInput({ companies, defaultValue = "", disabled, name = "target_companies", label = "Target companies, comma separated", fieldHint, value: controlledValue, onValueChange, catalogMessage }: { companies: CatalogCompanyOption[]; defaultValue?: string; disabled: boolean; name?: string; label?: string; fieldHint?: string; value?: string; onValueChange?: (value: string) => void; catalogMessage?: string }) {
  const [localValue, setLocalValue] = useState(defaultValue);
  const value = controlledValue ?? localValue;
  const updateValue = (next: string) => { setLocalValue(next); onValueChange?.(next); };
  const [focused, setFocused] = useState(false);
  const currentToken = value.slice(value.lastIndexOf(",") + 1).trim();
  const query = normalizeCompanyName(currentToken);
  const matches = query.length < 2 ? [] : companies.map((company) => {
    const key = normalizeCompanyName(company.normalizedName || company.name);
    const distance = editDistance(query, key);
    return { ...company, distance, key };
  }).filter((company) => company.key !== query && (company.key.startsWith(query) || query.startsWith(company.key) || company.distance <= Math.max(2, Math.floor(Math.max(query.length, company.key.length) * 0.3))))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, 5);
  const exact = companies.some((company) => normalizeCompanyName(company.normalizedName || company.name) === query);
  const tokens = [...new Set(value.split(",").map((token) => token.trim()).filter(Boolean))];
  const closeMatches = companies.length === 0 ? [] : tokens.flatMap((token) => {
    const tokenKey = normalizeCompanyName(token);
    if (companies.some((company) => normalizeCompanyName(company.normalizedName || company.name) === tokenKey)) return [];
    const nearest = companies.map((company) => ({ company, distance: editDistance(tokenKey, normalizeCompanyName(company.normalizedName || company.name)) }))
      .sort((a, b) => a.distance - b.distance)[0];
    return nearest && nearest.distance <= Math.max(2, Math.floor(Math.max(tokenKey.length, normalizeCompanyName(nearest.company.normalizedName || nearest.company.name).length) * 0.3)) ? [{ token, suggestion: nearest.company.name }] : [];
  });
  const unknownTokens = companies.length === 0 ? [] : tokens.filter((token) => !closeMatches.some((match) => match.token === token) && !companies.some((company) => normalizeCompanyName(company.normalizedName || company.name) === normalizeCompanyName(token)));
  const replaceCurrentToken = (name: string) => {
    const comma = value.lastIndexOf(",");
    const prefix = comma >= 0 ? `${value.slice(0, comma + 1)} ` : "";
    updateValue(`${prefix}${name}, `);
  };
  const showSuggestions = focused && !disabled && Boolean(query) && matches.length > 0;
  const showNotFound = focused && !disabled && companies.length > 0 && currentToken.length >= 2 && !exact && matches.length === 0;
  const otherUnknownTokens = unknownTokens.filter((token) => !(focused && normalizeCompanyName(token) === query));

  return <div className="company-target-field">
    <label className="profile-field">{label}{fieldHint && <small>{fieldHint}</small>}
      <input value={value} onChange={(event) => updateValue(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} autoComplete="off" aria-autocomplete="list" aria-expanded={showSuggestions} placeholder="Amazon, Flipkart" disabled={disabled} />
    </label>
    <input type="hidden" name={name} value={value} />
    {showSuggestions && <div className="company-suggestions" role="listbox" aria-label="Company catalog suggestions">
      {matches.map((company) => <button key={company.normalizedName} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { replaceCurrentToken(company.name); setFocused(true); }}><Building2 size={14} /><span><b>{company.name}</b><small>{company.distance ? "Closest company catalog match" : "Company catalog"}</small></span><span className="company-suggestion-action">Use</span></button>)}
    </div>}
    {showNotFound && <p className="company-target-hint">No close catalog match for “{currentToken}”. If this is intentional, add its official career details from Companies after signing in.</p>}
    {closeMatches.length > 0 && <p className="company-target-warning" role="status">Possible spelling: {closeMatches.map((match) => `${match.token} → ${match.suggestion}`).join(" · ")}. Select the catalog suggestion to correct it.</p>}
    {otherUnknownTokens.length > 0 && <p className="company-target-warning" role="status">Not in the company catalog: {otherUnknownTokens.join(", ")}. Add their official career details from Companies before discovery can scan them.</p>}
    {catalogMessage && <p className="company-target-warning" role="status">{catalogMessage}</p>}
    {focused && !currentToken && <p className="company-target-hint">Start typing to see matching companies from the shared catalog.</p>}
  </div>;
}
