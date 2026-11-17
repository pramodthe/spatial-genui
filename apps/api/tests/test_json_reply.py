from app.core.json_reply import extract_json


def test_a_reply_cut_off_mid_object_is_repaired():
    assert extract_json('{"a": 1') == {"a": 1}
    assert extract_json('{"a": [1, 2') == {"a": [1, 2]}
    assert extract_json('{"a": {"b": 1}') == {"a": {"b": 1}}


def test_a_fenced_block_is_read_from_the_reply():
    assert extract_json('Here it is:\n```json\n{"a": 1, "b": [2, 3]}\n```') == {"a": 1, "b": [2, 3]}
