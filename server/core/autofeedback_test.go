package core

import "testing"

// 42 writes a feedback itself when the evaluated student does not fill theirs in: no author, 4/5, always the same text.
// It is nobody's opinion: marked, and left out of every average.
func TestAutomaticFeedbackIsMarkedAndLeftOutOfAverages(t *testing.T) {
	auto := feedbackEntry(Raw{"user": nil, "rating": 4.0, "comment": "You failed to complete this feedback within the allocated time (this is very wrong), so we did it for you (do it next time)."})
	real := feedbackEntry(Raw{"user": Raw{"login": "peer02"}, "rating": 2.0, "comment": "You failed to complete this feedback, they said"})
	anon := feedbackEntry(Raw{"user": nil, "rating": 1.0, "comment": "fine"})
	if auto.V("auto") != true || real.Has("auto") || anon.Has("auto") {
		t.Fatalf("auto: %v %v %v", auto.V("auto"), real.Has("auto"), anon.Has("auto"))
	}
	if got := feedbackScores([]*OMap{auto, real}).V("rating"); got != 2.0 {
		t.Fatalf("rating with an automatic one = %v, want 2 (the real one alone)", got)
	}
	if got := feedbackScores([]*OMap{auto}).V("rating"); got != nil {
		t.Fatalf("only automatic = %v, want none", got)
	}
}
