import { DotFilledIcon } from '@radix-ui/react-icons';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { VERDICT_META, type Review } from '@/lib/agent-result';

type ReviewPanelProps = {
  review: Review;
  rounds: number;
};

/** Итог safety review: вердикт, оценка, число раундов, замечания. */
export function ReviewPanel({ review, rounds }: ReviewPanelProps) {
  const meta = VERDICT_META[review.verdict];

  return (
    <Card className="enter gap-0 rounded-xl border-border bg-card py-0 shadow-none">
      <CardContent className="px-5 py-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">Safety review</h2>
          <Badge className={`${meta.badge} tracking-[0.08em] uppercase`}>{review.verdict}</Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{meta.gloss}</p>
      </CardContent>

      <Separator />

      <CardContent className="px-5 py-5">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Оценка</span>
          <span className="font-mono text-sm text-foreground">
            {review.score}
            <span className="text-muted-foreground">/10</span>
          </span>
        </div>
        {/* Заливку индикатора shadcn жёстко ставит в bg-primary — перекрываем снаружи, не трогая примитив. */}
        <Progress
          value={review.score * 10}
          className="mt-3 h-1 rounded-none bg-secondary [&>[data-slot=progress-indicator]]:bg-brand"
        />

        <div className="mt-5 flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">Раундов доработки</span>
          <span className="font-mono text-sm text-foreground">
            {rounds}
            <span className="text-muted-foreground">/3</span>
          </span>
        </div>
      </CardContent>

      <Separator />

      <CardContent className="px-5 py-5">
        <h3 className="text-xs font-medium tracking-[0.12em] text-muted-foreground uppercase">
          Замечания
          <span className="ml-2 font-mono tracking-normal normal-case">{review.issues.length}</span>
        </h3>

        {review.issues.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Ревьюер не нашёл нарушений.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {review.issues.map((issue, index) => (
              <li key={index} className="flex gap-1.5 text-sm leading-relaxed">
                <DotFilledIcon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                <span>{issue}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
