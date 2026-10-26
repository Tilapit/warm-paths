import { ensureMatching, loadNetwork } from "@/lib/network.ts";
import { drawingData } from "@/lib/view.ts";
import { matchJob } from "@/lib/matching.ts";
import { NetworkView } from "@/components/NetworkView";
import { MatchProgress } from "@/components/MatchProgress";
import { FirstRun } from "@/components/FirstRun";
import { ProfileEditor } from "@/components/SettingsParts";
import { profileIsEmpty } from "@/lib/industry.ts";
import { canIntroduce, engagedNotConnected, followUps, funnel, thisWeek, type FollowUp, type IntroPick, type WeekPick } from "@/lib/queries.ts";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ p?: string; skip?: string }> }) {
  const { p, skip } = await searchParams;
  const net = await loadNetwork();
  if (!net.owners.length) return <FirstRun />;
  ensureMatching(net);
  // Nothing said yet: ask first. The network is one click away.
  if (profileIsEmpty(net.profile) && !skip)
    return (
      <main className="page" style={{ maxWidth: 820 }}>
        <h1>Tell us what you&apos;re looking for</h1>
        <p className="lede">
          A job, investors, customers, advice, speakers for an event: say it in your own words. Your {net.stats.contacts.toLocaleString("en-US")} connections are then ranked for it, by code, on this machine. You can change it any time here or by telling Claude.
        </p>
        <div className="card" style={{ padding: 20 }}>
          <ProfileEditor profile={net.profile} setup />
        </div>
        <p className="small muted" style={{ marginTop: 14 }}>
          An example profile is in docs/example-profile.md. <a href="/?skip=1">Skip: show the network without a profile</a>
        </p>
      </main>
    );
  const d = drawingData(net);
  const slim = ({ id, name, title, company, fit, status, kind, why, sender, prompt, cooldown }: WeekPick) => ({ id, name, title, company, fit, status, kind, why, sender, prompt, cooldown });
  const due = ({ id, name, title, company, sentOn, sentBy, followUpOn }: FollowUp) => ({ id, name, title, company, sentOn, sentBy, followUpOn });
  // The whole team's five, and each teammate's for the owner filter.
  const week = thisWeek(net).map(slim);
  const weekBy = net.owners.map((o) => thisWeek(net, 5, o.id).map(slim));
  // Follow-ups due: the team's, and what each teammate sent.
  const follow = followUps(net).people.map(due);
  const followBy = net.owners.map((o) => followUps(net, o.id).people.map(due));
  // Ask for an intro: the team's three, and each teammate's.
  const slimIntro = ({ total, people }: { total: number; people: IntroPick[] }) => ({ total, people: people.map(({ id, name, title, company, why, sender, prompt, cooldown }) => ({ id, name, title, company, why, sender, prompt, cooldown })) });
  const intro = slimIntro(canIntroduce(net));
  const introBy = net.owners.map((o) => slimIntro(canIntroduce(net, 3, o.id)));
  // Reacted to a team post, in no one's network: the team's, and per teammate (their posts).
  const engaged = engagedNotConnected(net);
  const engagedBy = net.owners.map((o) => engagedNotConnected(net, 5, o.id));
  const steps = funnel(net);
  const stepsBy = net.owners.map((o) => funnel(net, o.id));
  const job = matchJob();
  return (
    <>
      <MatchProgress initial={{ ...job }} />
      <NetworkView {...d} week={week} weekBy={weekBy} intro={intro} introBy={introBy} engaged={engaged} engagedBy={engagedBy} funnel={steps} funnelBy={stepsBy} follow={follow} followBy={followBy} initial={p && net.byId.has(p) ? p : undefined} />
    </>
  );
}
