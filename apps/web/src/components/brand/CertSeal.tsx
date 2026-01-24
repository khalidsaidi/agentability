type Props = {
  specVersion?: string;
  dateISO?: string;
  className?: string;
};

export function CertSeal({ specVersion, dateISO, className }: Props) {
  const date = (dateISO || "").slice(0, 10);
  const line = [specVersion ? `SPEC ${specVersion}` : null, date ? date : null]
    .filter(Boolean)
    .join(" - ");

  return (
    <div className={`relative ${className || ""}`}>
      <img src="/cert-seal.svg" alt="Agentability certified seal" className="h-auto w-full" />
      {line ? (
        <div className="absolute inset-x-0 bottom-[16%] text-center">
          <span className="text-xs font-mono opacity-80">{line}</span>
        </div>
      ) : null}
    </div>
  );
}
