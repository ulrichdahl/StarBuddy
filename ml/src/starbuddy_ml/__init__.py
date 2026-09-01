"""Stage A of StarBuddy's screen scanner: find the in-world panel, name the screen.

The model here never reads text. It predicts the four corners of the game panel
plus a few coarse classifications; the client then rectifies by homography and
hands the flat image to the existing `ocrs` pipeline.
"""
