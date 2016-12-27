#Code for ingesting data from echoprint.me/data 
#Max Woolf
#maximus@zingysaturn.co.uk

import json, httplib2, urllib
json_data=open('./jsondumps/echoprint-dump-1.json')

data = json.load(json_data)



for i in data:
	#grab all the data for this track and save the important information
	code = i['code']
	length = i['metadata']['duration']
	version = '4.12'
	artist = i['metadata']['artist']
	title = i['metadata']['title']

	body = {'code': code, 'version': version, 'length': length, 'artist': artist, 'track': title}
	http = httplib2.Http()
	url = 'http://localhost:37760/ingest'
	response, content = http.request(url, 'POST', headers=None, body=urllib.urlencode(body))