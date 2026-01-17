import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type CopyLinksProps = {
  reportUrl?: string;
  jsonUrl?: string;
  evidenceUrl?: string;
};

type LinkRowProps = {
  label: string;
  value?: string;
};

function LinkRow({ label, value }: LinkRowProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <div className="w-32 text-sm text-muted-foreground">{label}</div>
      <Input value={value || ""} readOnly className="h-10 flex-1 bg-white/70" />
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          if (value) {
            void navigator.clipboard.writeText(value);
          }
        }}
      >
        Copy
      </Button>
    </div>
  );
}

export function CopyLinks({ reportUrl, jsonUrl, evidenceUrl }: CopyLinksProps) {
  return (
    <div className="space-y-3">
      <LinkRow label="Report" value={reportUrl} />
      <LinkRow label="JSON" value={jsonUrl} />
      {evidenceUrl ? <LinkRow label="Evidence" value={evidenceUrl} /> : null}
    </div>
  );
}
