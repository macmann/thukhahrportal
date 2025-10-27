import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPerformanceReview } from '@/lib/performanceReviews';

interface PageProps {
  params: {
    id: string;
  };
}

const formatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
});

export default async function PerformanceReviewDetailPage({ params }: PageProps) {
  const review = await getPerformanceReview(params.id);

  if (!review) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <Link href="/performance-reviews" className="text-sm font-medium text-brand-600 hover:text-brand-700">
        &larr; Back to reviews
      </Link>

      <div className="card space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Employee #{review.employeeId}</h2>
            <p className="mt-1 text-sm text-slate-600">Reviewer: {review.reviewerId}</p>
          </div>
          <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-brand-700">
            {review.status}
          </span>
        </header>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Period</dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatter.format(new Date(review.reviewPeriodStart))} &ndash;{' '}
              {formatter.format(new Date(review.reviewPeriodEnd))}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Overall rating</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{review.overallRating}</dd>
          </div>
        </dl>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Strengths</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700 whitespace-pre-line">{review.strengths}</p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Opportunities</h3>
          <p className="mt-2 text-sm leading-6 text-slate-700 whitespace-pre-line">{review.opportunities}</p>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-slate-900">Goals</h3>
          {review.goals.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No goals recorded.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm text-slate-700">
              {review.goals.map((goal, index) => (
                <li key={goal} className="flex gap-2">
                  <span className="font-semibold text-brand-600">{index + 1}.</span>
                  <span>{goal}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-slate-500">
          Last updated {formatter.format(new Date(review.updatedAt))}
        </p>
      </div>
    </div>
  );
}
