import { NextResponse } from 'next/server';
import {
  getPerformanceReview,
  updatePerformanceReview
} from '@/lib/performanceReviews';
import { ZodError } from 'zod';

interface RouteParams {
  params: {
    id: string;
  };
}

export async function GET(_: Request, { params }: RouteParams) {
  try {
    const review = await getPerformanceReview(params.id);
    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    return NextResponse.json(review);
  } catch (error) {
    console.error('Failed to load performance review', error);
    return NextResponse.json({ error: 'Unable to load performance review' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const body = await request.json();
    const review = await updatePerformanceReview(params.id, body);

    if (!review) {
      return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    }

    return NextResponse.json(review);
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', details: error.issues }, { status: 422 });
    }

    console.error('Failed to update performance review', error);
    return NextResponse.json({ error: 'Unable to update performance review' }, { status: 500 });
  }
}
