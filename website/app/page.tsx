import { redirect } from 'next/navigation'

/**
 * There is no marketing site any more — this is a tool you run, not a product
 * you sign up for. Opening the app should put you in it.
 */
export default function Home() {
  redirect('/dashboard')
}
