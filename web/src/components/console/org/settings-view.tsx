"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/app/field";
import { LogoMark } from "@/components/app/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Organisation } from "@/lib/api";
import { IconChip } from "@/components/console/ui";
import { Problem } from "@/components/runs/problem";
import { OnlyAdmins } from "./only-admins";

/** Organisation settings: the name and logo the console shows (admins). */
export function SettingsView({ initial }: { initial?: Organisation }) {
  const auth = useAuth();
  const router = useRouter();
  const org = useResource((s) => api.org(s), "org-settings", initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [logo, setLogo] = useState(initial?.logo_url ?? "");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof toDisplayError> | null>(null);

  useEffect(() => {
    if (!org.data) return;
    setName(org.data.name);
    setLogo(org.data.logo_url ?? "");
  }, [org.data]);

  if (!auth.can("manage_org")) return <OnlyAdmins what="change the organisation's name and logo" />;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    try {
      const updated = await api.updateOrg({ name: name.trim(), logo_url: logo.trim() || null });
      org.setData(updated);
      toast.success("Organisation saved");
      // The shell reads the organisation from the layout's server render.
      router.refresh();
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Settings"
        description="The organisation's name and mark, shown at the top of the console for every member."
      />
      {org.error && !org.data ? (
        <Problem error={org.error} title="Could not load the organisation" onRetry={org.reload} />
      ) : (
        <form onSubmit={save} className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Card aria-labelledby="org-title">
            <CardHeader id="org-title" title="Organisation" actions={<IconChip icon={Building2} />} />
            <div className="mt-4 grid gap-4">
              <Field id="org-name" label="Name" help="Up to 120 characters.">
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                  required
                  autoComplete="organization"
                />
              </Field>
              <Field
                id="org-logo"
                label="Logo"
                optional
                help="The address of a square image (https). Leave it empty to show the Payslip mark."
              >
                <Input
                  id="org-logo"
                  type="url"
                  value={logo}
                  onChange={(e) => setLogo(e.target.value)}
                  placeholder="https://"
                  inputMode="url"
                />
              </Field>
              {problem ? <Problem error={problem} /> : null}
              <div className="flex items-center gap-2 border-t border-hairline pt-4">
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? "Saving" : "Save"}
                </Button>
              </div>
            </div>
          </Card>
          <Card aria-labelledby="preview-title" className="self-start">
            <CardHeader id="preview-title" title="How it looks" />
            <div className="mt-4 flex items-center gap-2.5 rounded-lg bg-sidebar px-3 py-2.5">
              {logo.trim() ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo.trim()} alt="" className="size-[22px] shrink-0 rounded-[5px] object-cover" />
              ) : (
                <LogoMark className="size-[22px]" />
              )}
              <span className="min-w-0 truncate font-[450]">{name.trim() || "Payslip"}</span>
            </div>
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              Members see this at the top of the sidebar. Payslips and statements keep naming the company from the
              payroll itself.
            </p>
          </Card>
        </form>
      )}
    </>
  );
}
