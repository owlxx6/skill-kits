// License texts used by the tests. MIT, ISC and the BSD texts are complete; the long
// licenses keep their title block and a few lines, which is what identification reads.

export const MIT_TEXT = `MIT License

Copyright (c) 2025 Acme

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
`;

export const ISC_TEXT = `ISC License

Copyright (c) 2025 Acme

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
`;

const BSD_HEAD = `Copyright (c) 2025, Acme
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
`;

const BSD_TAIL = `
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS".
`;

export const BSD2_TEXT = `BSD 2-Clause License\n\n${BSD_HEAD}${BSD_TAIL}`;

export const BSD3_TEXT = `BSD 3-Clause License\n\n${BSD_HEAD}
3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.
${BSD_TAIL}`;

export const BSD4_TEXT = `${BSD3_TEXT}
4. All advertising materials mentioning features or use of this software must
   display the following acknowledgement.
`;

export const APACHE_TEXT = `
                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION
`;

export const APACHE_NOTICE = `Copyright 2025 Acme

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
`;

export const GPL3_TEXT = `                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
`;

export const GPL2_TEXT = `                    GNU GENERAL PUBLIC LICENSE
                       Version 2, June 1991
`;

export const LGPL3_TEXT = `                   GNU LESSER GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

  This version of the GNU Lesser General Public License incorporates
the terms and conditions of version 3 of the GNU General Public
License, supplemented by the additional permissions listed below.
`;

export const LGPL21_TEXT = `                  GNU LESSER GENERAL PUBLIC LICENSE
                       Version 2.1, February 1999
`;

export const AGPL3_TEXT = `                    GNU AFFERO GENERAL PUBLIC LICENSE
                       Version 3, 19 November 2007
`;

export const CUSTOM_TEXT = `Copyright (c) 2025 Acme. All rights reserved.
You may use this skill for personal purposes only.
`;
