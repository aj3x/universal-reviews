import { call, client } from "../../lib/api";
import { ReviewList } from "./ReviewList";

export function Feed() {
  return (
    <>
      <h1>Feed</h1>
      <ReviewList listKey="feed" load={(cursor) => call(client.feed.$get({ query: { cursor } }))} empty="Nothing yet. Add your first review." />
    </>
  );
}
