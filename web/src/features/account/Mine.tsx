import { call, client } from "../../lib/api";
import { ReviewList } from "../feed/ReviewList";

export function Mine({ user, onLogout }: { user: { displayName: string }; onLogout: () => void }) {
  return (
    <>
      <h1>{user.displayName}</h1>
      <ReviewList listKey="mine" load={(cursor) => call(client.me.reviews.$get({ query: { cursor } }))} empty="You haven't reviewed anything yet." />
      <button onClick={onLogout}>Sign out</button>
    </>
  );
}
