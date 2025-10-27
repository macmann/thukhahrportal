import Link from 'next/link';
import { listPerformanceReviews } from '@/lib/performanceReviews';
import type { PerformanceReviewDTO } from '@/lib/types';

function ReviewCard({ review }: { review: PerformanceReviewDTO }) {
  const rangeFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
  const startDate = rangeFormatter.format(new Date(review.reviewPeriodStart));
  const endDate = rangeFormatter.format(new Date(review.reviewPeriodEnd));
  const formattedPeriod = `${startDate} – ${endDate}`;

  const formattedUpdated = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(new Date(review.updatedAt));

  const ratingLabels: Record<PerformanceReviewDTO['overallRating'], string> = {
    outstanding: 'Outstanding',
    exceeds: 'Exceeds Expectations',
    meets: 'Meets Expectations',
    progressing: 'Progressing',
    unsatisfactory: 'Unsatisfactory'
  };

  return (
    <Link
      href={`/performance-reviews/${review.id}`}
      className="card block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-brand-700">{formattedPeriod}</p>
          <h2 className="mt-2 text-lg font-semibold text-slate-900">Employee #{review.employeeId}</h2>
          <p className="mt-1 text-sm text-slate-600">Reviewer: {review.reviewerId}</p>
        </div>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
          {ratingLabels[review.overallRating]}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-slate-500">Status</dt>
          <dd className="mt-1 capitalize text-slate-900">{review.status}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Last updated</dt>
          <dd className="mt-1 text-slate-900">{formattedUpdated}</dd>
        </div>
      </dl>
    </Link>
  );
}

export default async function PerformanceReviewsPage() {
  const reviews = await listPerformanceReviews();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Review Cycles</h2>
          <p className="text-sm text-slate-600">Monitor employee progress and maintain a central audit trail.</p>
        </div>
        <Link href="/performance-reviews/new" className="button-primary">
          Create review
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className="card text-center">
          <h3 className="text-lg font-semibold text-slate-900">No reviews yet</h3>
          <p className="mt-2 text-sm text-slate-600">
            Create the first performance review to kick off a transparent feedback cycle.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {reviews.map(review => (
            <ReviewCard key={review.id} review={review} />
          ))}
        </div>
      )}
    </div>
  );
}
