#!/usr/bin/env python3
"""Build the "Save to Trove" Apple Shortcut (iPhone, iPad, Mac share sheet).

The API key is asked once at install time (import question), so the published
file contains no secret. Usage:
  python3 scripts/make-shortcut.py https://trove.mariomedpar.com web/public/trove.shortcut
Then sign it:  shortcuts sign --mode anyone --input unsigned.shortcut --output signed.shortcut
"""
import plistlib
import sys
import uuid

base = sys.argv[1].rstrip('/') if len(sys.argv) > 1 else 'https://trove.mariomedpar.com'
out = sys.argv[2] if len(sys.argv) > 2 else 'trove-unsigned.shortcut'

key_uuid = str(uuid.uuid4()).upper()
req_uuid = str(uuid.uuid4()).upper()
title_uuid = str(uuid.uuid4()).upper()

OBJ = '￼'


def token(attachments, text=OBJ):
    """A text field containing variables (each OBJ placeholder is one attachment)."""
    spots = [i for i, ch in enumerate(text) if ch == OBJ]
    return {
        'Value': {'string': text, 'attachmentsByRange': {f'{{{pos}, 1}}': att for pos, att in zip(spots, attachments)}},
        'WFSerializationType': 'WFTextTokenString',
    }


def plain(s):
    return {'Value': {'string': s, 'attachmentsByRange': {}}, 'WFSerializationType': 'WFTextTokenString'}


def field(key, value):
    return {'WFItemType': 0, 'WFKey': plain(key), 'WFValue': value}


shortcut_input = {'Type': 'ExtensionInput'}
api_key = {'Type': 'ActionOutput', 'OutputName': 'Text', 'OutputUUID': key_uuid}
response = {'Type': 'ActionOutput', 'OutputName': 'Contents of URL', 'OutputUUID': req_uuid}
title = {'Type': 'ActionOutput', 'OutputName': 'Dictionary Value', 'OutputUUID': title_uuid}

actions = [
    # 0: the API key (filled in by the import question)
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.gettext',
        'WFWorkflowActionParameters': {'UUID': key_uuid, 'WFTextActionText': ''},
    },
    # 1: POST the shared thing (URL, page or text) to Trove
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.downloadurl',
        'WFWorkflowActionParameters': {
            'UUID': req_uuid,
            'WFURL': f'{base}/api/items',
            'WFHTTPMethod': 'POST',
            'WFHTTPBodyType': 'JSON',
            'ShowHeaders': True,
            'WFHTTPHeaders': {
                'Value': {'WFDictionaryFieldValueItems': [field('Authorization', token([api_key], 'Bearer ' + OBJ)), field('Content-Type', plain('application/json'))]},
                'WFSerializationType': 'WFDictionaryFieldValue',
            },
            'WFJSONValues': {
                'Value': {
                    'WFDictionaryFieldValueItems': [
                        field('text', token([shortcut_input])),
                        field('source', plain('Shortcut')),
                        field('via', plain('Apple Shortcut')),
                    ]
                },
                'WFSerializationType': 'WFDictionaryFieldValue',
            },
        },
    },
    # 2: read item.title from the JSON response
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.getvalueforkey',
        'WFWorkflowActionParameters': {'UUID': title_uuid, 'WFDictionaryKey': 'item.title', 'WFInput': {'Value': response, 'WFSerializationType': 'WFTextTokenAttachment'}},
    },
    # 3: confirm
    {
        'WFWorkflowActionIdentifier': 'is.workflow.actions.notification',
        'WFWorkflowActionParameters': {'WFNotificationActionTitle': 'Saved to Trove', 'WFNotificationActionBody': token([title]), 'WFNotificationActionSound': False},
    },
]

workflow = {
    'WFWorkflowClientVersion': '2605.0.5',
    'WFWorkflowMinimumClientVersion': 900,
    'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowName': 'Save to Trove',
    'WFWorkflowIcon': {'WFWorkflowIconStartColor': 4282601983, 'WFWorkflowIconGlyphNumber': 59511},
    'WFWorkflowTypes': ['ActionExtension', 'QuickActions', 'MenuBar'],
    'WFQuickActionSurfaces': ['Finder', 'Services'],
    'WFWorkflowHasShortcutInputVariables': True,
    'WFWorkflowInputContentItemClasses': [
        'WFURLContentItem',
        'WFSafariWebPageContentItem',
        'WFArticleContentItem',
        'WFStringContentItem',
        'WFRichTextContentItem',
    ],
    'WFWorkflowImportQuestions': [
        {
            'ActionIndex': 0,
            'Category': 'Parameter',
            'DefaultValue': '',
            'ParameterKey': 'WFTextActionText',
            'Text': 'Paste your Trove API key (Trove → Settings → API keys → “Shortcut”).',
        }
    ],
    'WFWorkflowActions': actions,
}

with open(out, 'wb') as f:
    plistlib.dump(workflow, f, fmt=plistlib.FMT_BINARY)
print(out)
