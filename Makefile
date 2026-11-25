# Previews that open with a double click, no server: preview/cv.html and preview/42.html (tools/preview.py);
# preview-template writes them to preview/template/.
.PHONY: preview preview-template clean

# With cv.json and data/42.json; the examples in tools/ stand in for whichever is missing
preview:
	python3 tools/preview.py preview

# With the examples in tools/ only
preview-template:
	python3 tools/preview.py preview/template --template

clean:
	rm -rf preview
