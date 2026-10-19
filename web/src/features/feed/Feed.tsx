import { ReviewList } from "./ReviewList";

export function Feed() {
  return (<><h1>Feed</h1><ReviewList path="/feed" empty="Nothing yet. Add your first review." /></>);
}
