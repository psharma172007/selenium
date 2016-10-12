# Licensed to the Software Freedom Conservancy (SFC) under one
# or more contributor license agreements.  See the NOTICE file
# distributed with this work for additional information
# regarding copyright ownership.  The SFC licenses this file
# to you under the Apache License, Version 2.0 (the
# "License"); you may not use this file except in compliance
# with the License.  You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing,
# software distributed under the License is distributed on an
# "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
# KIND, either express or implied.  See the License for the
# specific language governing permissions and limitations
# under the License.

import pytest
import shutil
import tempfile
import types

from selenium.webdriver.firefox.firefox_binary import FirefoxBinary
from selenium.webdriver.firefox.firefox_profile import FirefoxProfile
from selenium.webdriver.firefox.options import Log, Options
from selenium.webdriver import Firefox


@pytest.fixture
def driver(capabilities):
    driver = Firefox(firefox_options=Options(), capabilities=capabilities)
    yield driver
    driver.quit()


class TestIntegration(object):
    def test_we_can_pass_options(self, driver, pages):
        pages.load("formPage.html")
        driver.find_element_by_id("cheese")


class TestUnit(object):
    def test_ctor(self):
        opts = Options()
        assert opts._binary is None
        assert opts._profile is None
        assert opts._arguments == []
        assert isinstance(opts.log, Log)

    def test_binary(self):
        opts = Options()
        assert opts.binary is None

        other_binary = FirefoxBinary()
        assert other_binary != opts.binary
        opts.binary = other_binary
        assert other_binary == opts.binary

        path = "/path/to/binary"
        opts.binary = path
        assert isinstance(opts.binary, FirefoxBinary)
        assert opts.binary._start_cmd == path

    def test_profile(self, tmpdir_factory):
        opts = Options()
        assert opts.profile is None

        other_profile = FirefoxProfile()
        assert other_profile != opts.profile
        opts.profile = other_profile
        assert other_profile == opts.profile

        opts.profile = str(tmpdir_factory.mktemp("profile"))
        assert isinstance(opts.profile, FirefoxProfile)

    def test_arguments(self):
        opts = Options()
        assert len(opts.arguments) == 0

        opts.add_argument("--foo")
        assert len(opts.arguments) == 1
        opts.arguments.append("--bar")
        assert len(opts.arguments) == 2
        assert opts.arguments == ["--foo", "--bar"]

    def test_to_capabilities(self):
        opts = Options()
        assert opts.to_capabilities() == {}

        profile = FirefoxProfile()
        opts.profile = profile
        caps = opts.to_capabilities()
        assert "moz:firefoxOptions" in caps
        assert "profile" in caps["moz:firefoxOptions"]
        assert isinstance(caps["moz:firefoxOptions"]["profile"], types.StringTypes)
        assert caps["moz:firefoxOptions"]["profile"] == profile.encoded

        opts.add_argument("--foo")
        caps = opts.to_capabilities()
        assert "moz:firefoxOptions" in caps
        assert "args" in caps["moz:firefoxOptions"]
        assert caps["moz:firefoxOptions"]["args"] == ["--foo"]

        binary = FirefoxBinary()
        opts.binary = binary
        caps = opts.to_capabilities()
        assert "moz:firefoxOptions" in caps
        assert "binary" in caps["moz:firefoxOptions"]
        assert isinstance(caps["moz:firefoxOptions"]["binary"], types.StringTypes)
        assert caps["moz:firefoxOptions"]["binary"] == binary._start_cmd